#!/usr/bin/env python3
"""Derive assets/intro/bigu-intro.webm from assets/intro/bigu-intro-source.mp4.

WHY THIS EXISTS
---------------
The supplied source renders transparency as a baked-in checkerboard (two
neutral greys, ~#5F5F5F / ~#7A7A7A, filling ~63% of every frame) because the
generator wrote an opaque yuv420p H.264 stream. Dropped straight onto the
intro's #121312 overlay that checkerboard reads as a large grey rectangle, so
it has to become a real alpha channel before the footage is usable.

Nothing about the animation itself is altered — this only removes a background
that was never meant to be seen, and drops the (unused, autoplay-blocking)
audio track.

HOW THE KEY WORKS
-----------------
Over the neutral checkerboard the artwork is either white or saturated blue, so
a pixel is foreground when it is *either* much brighter than the checkerboard
*or* noticeably saturated. Both tests produce a soft 0..1 ramp rather than a
hard cut, which keeps antialiased edges smooth; the colour is then un-blended
from the grey so those edges carry no grey fringe.

USAGE
-----
    pip install pillow numpy imageio-ffmpeg
    python3 tools/build-intro-video.py

Re-run this whenever the source animation is replaced. If the composition
changes, also paste the MARK_RECT it prints into js/intro/introConfig.js — that
rect is what makes the hand-off land pixel-perfectly on the header mark.
"""

import glob
import os
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets", "intro", "bigu-intro-source.mp4")
TARGET = os.path.join(ROOT, "assets", "intro", "bigu-intro.webm")

# Keying thresholds, tuned against the source's actual pixel statistics.
GREY = 108.0                      # mean checkerboard luma, used to un-blend edges
LUMA_LO, LUMA_HI = 132.0, 205.0   # neutral pixels ramp to opaque across this band
SAT_LO, SAT_HI = 14.0, 70.0       # saturated pixels ramp to opaque across this band

# Alpha below this is snapped to fully transparent. The source paints a soft
# drop shadow onto the checkerboard; keyed, it survives as a wide, very faint
# halo that VP9 quantises into visible blocking around the wordmark. It carries
# no detail worth keeping, and cutting it removes the artefact outright.
ALPHA_TOE = 0.12

# Floor for the un-blend divisor — see the note in key_frame().
UNBLEND_FLOOR = 0.35

# The source is itself a lossy H.264 encode, so the soft glow it paints around
# the wordmark arrives already broken into 8x8 blocks. Keying turns that into
# blocky *alpha*, which is far more visible than blocky colour was. Blurring
# only the faint part of the matte smooths it back into a glow; solid artwork
# stays untouched, so logo edges keep their bite.
HAZE_BLUR_RADIUS = 2.5
HAZE_SOLID_ALPHA = 0.55   # at or above this, the matte is left exactly as-is

OUT_WIDTH = 960                   # the mark is only ~22% of frame width; 960 is plenty
CRF = 32
KEYFRAME_INTERVAL = 48            # keeps the clip seekable / scrubbable


def ffmpeg():
    """Prefer a system ffmpeg, fall back to the imageio-ffmpeg binary."""
    return shutil.which("ffmpeg") or __import__("imageio_ffmpeg").get_ffmpeg_exe()


def key_frame(path, dest):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    sat = rgb.max(2) - rgb.min(2)
    luma = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]

    alpha = np.maximum(
        np.clip((luma - LUMA_LO) / (LUMA_HI - LUMA_LO), 0, 1),
        np.clip((sat - SAT_LO) / (SAT_HI - SAT_LO), 0, 1),
    )
    # Drop the shadow halo, then rescale so real antialiased edges still reach 1.
    alpha = np.clip((alpha - ALPHA_TOE) / (1.0 - ALPHA_TOE), 0, 1)

    # De-block the glow: blend toward a blurred matte, weighted so the swap is
    # total in the faintest areas and nil on solid artwork.
    blurred = np.asarray(
        Image.fromarray((alpha * 255).astype(np.uint8))
        .filter(ImageFilter.GaussianBlur(HAZE_BLUR_RADIUS))
    ).astype(np.float32) / 255.0
    solid = np.clip(alpha / HAZE_SOLID_ALPHA, 0, 1)
    alpha = alpha * solid + blurred * (1.0 - solid)

    # observed = fg*a + grey*(1-a)  ->  fg = (observed - grey*(1-a)) / a
    #
    # Two guards matter here, and both exist because VP9 stores alpha as a
    # separate lossy plane: what should be alpha 0 comes back very slightly
    # above 0, which makes whatever colour sits in those "invisible" pixels
    # visible after all.
    #
    #   * Dividing by a vanishing alpha explodes into saturated colour, so the
    #     divisor is floored — that under-corrects faint pixels, which is
    #     invisible, instead of producing neon speckle, which is not.
    #   * Fully transparent pixels are flushed to black rather than left
    #     holding the original checkerboard. Left as-is, the leak paints the
    #     checkerboard back onto the overlay in blocky patches.
    #
    # Flat black also compresses far better than checkerboard noise: it roughly
    # halves the encoded size on top of fixing the artefact.
    a3 = alpha[..., None]
    fg = (rgb - GREY * (1.0 - a3)) / np.maximum(a3, UNBLEND_FLOOR)
    fg = np.where(a3 > 0.0, fg, 0.0)
    frame = np.concatenate([np.clip(fg, 0, 255), a3 * 255], axis=2)
    Image.fromarray(frame.astype(np.uint8), "RGBA").save(dest)


def measure_mark(path):
    """Report the logo mark's rect within the frame, as normalised fractions.

    The final frame holds the bubble mark stacked above the "Bigu / ビグ"
    wordmark. Only the bubble flies to the header, so the hand-off needs that
    sub-rect — found here as the artwork above the first empty row band.
    """
    # Threshold high enough to ignore the soft glow around the artwork — the
    # hand-off has to line up with the solid bubble a reader actually sees, not
    # with the halo bleeding off it.
    alpha = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    height, width = alpha.shape
    solid = alpha > 160
    rows = solid.sum(1)

    filled = np.nonzero(rows > 2)[0]
    split, run = None, None
    for y in range(filled.min(), filled.max() + 1):
        if rows[y] <= 2:
            run = y if run is None else run
        else:
            if run is not None and y - run > 6:
                split = run
                break
            run = None

    ys, xs = np.nonzero(solid[:split, :])
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    print("\nMARK_RECT for js/intro/introConfig.js:")
    print(f"  x: {x0 / width:.6f},  y: {y0 / height:.6f},")
    print(f"  width: {(x1 - x0) / width:.6f},  height: {(y1 - y0) / height:.6f},")


def main():
    ff = ffmpeg()
    with tempfile.TemporaryDirectory() as work:
        raw, keyed = os.path.join(work, "raw"), os.path.join(work, "keyed")
        os.makedirs(raw)
        os.makedirs(keyed)

        subprocess.run(
            [ff, "-y", "-v", "error", "-i", SOURCE, "-vsync", "0", f"{raw}/%04d.png"],
            check=True,
        )
        frames = sorted(glob.glob(f"{raw}/*.png"))
        print(f"keying {len(frames)} frames…")
        for frame in frames:
            key_frame(frame, os.path.join(keyed, os.path.basename(frame)))

        subprocess.run(
            [
                ff, "-y", "-v", "error",
                "-framerate", "24",
                "-i", f"{keyed}/%04d.png",
                "-vf", f"scale={OUT_WIDTH}:-1:flags=lanczos",
                "-c:v", "libvpx-vp9",
                "-pix_fmt", "yuva420p",   # the alpha-carrying pixel format
                "-b:v", "0", "-crf", str(CRF), "-row-mt", "1",
                "-g", str(KEYFRAME_INTERVAL),
                "-an",                    # muted anyway; drop the audio track
                TARGET,
            ],
            check=True,
        )
        print(f"wrote {TARGET} ({os.path.getsize(TARGET) / 1e6:.1f} MB)")
        measure_mark(sorted(glob.glob(f"{keyed}/*.png"))[-1])


if __name__ == "__main__":
    main()
