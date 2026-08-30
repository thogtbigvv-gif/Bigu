#!/usr/bin/env python3
"""Render icons/icon.svg to the raster sizes index.html and manifest.json ask for.

The app itself has no build step and this is not part of one — it is a one-off
regenerator, checked in so the PNGs beside it can be reproduced rather than
being opaque binaries nobody can rebuild. Run it only after editing
icons/icon.svg:

    pip install cairosvg && python3 tools/build-icons.py

apple-touch-icon.png is the one iOS reads when a reader adds Bigu to their
home screen; 192 and 512 are the two sizes the web app manifest declares.

The two maskable files are the same drawing shrunk inside its own ground.
Android does not show a launcher icon as it is given: it cuts it to whatever
shape the phone uses — a circle, a squircle, a rounded square — and an icon
that does not declare itself maskable is dropped into a white badge and
shrunk to be safe, which is how a carefully drawn mark ends up as a stamp
inside a white circle. A maskable icon opts out of that by promising
something instead: everything that matters sits inside the central 80%, so
the launcher may cut anywhere outside it. MASKABLE_SCALE is that promise —
at 0.72 the bubble, the book and both sparkles are inside the safe circle,
and what the mask takes is ground.
"""

import pathlib

import cairosvg

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "icons" / "icon.svg"

# (filename, pixel size). 180 is Apple's current touch-icon size; 192 and 512
# are the manifest's, 512 doubling as the splash/install artwork.
TARGETS = [
    ("apple-touch-icon.png", 180),
    ("icon-192.png", 192),
    ("icon-512.png", 512),
]

# The same drawing, inset for Android's launcher masks. Same two sizes the
# manifest declares for the plain icons, because a maskable icon replaces
# them on that platform rather than supplementing them.
MASKABLE_TARGETS = [
    ("icon-maskable-192.png", 192),
    ("icon-maskable-512.png", 512),
]

MASKABLE_SCALE = 0.72
# icon.svg's own ground, so the inset and the drawing's own background are
# one colour and the mask cuts a solid tile rather than a border.
MASKABLE_GROUND = "#E9EBE4"


def maskable_svg(svg_text):
    """The source drawing, scaled about its centre on a full-bleed ground.

    The source is nested as a group rather than as a nested <svg>: it carries
    its own width/height/viewBox, and a nested element would have to have all
    three overridden to be placed. Its body only needs a transform.
    """
    body = svg_text[svg_text.index(">") + 1:svg_text.rindex("</svg>")]
    offset = 64 * (1 - MASKABLE_SCALE) / 2
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
        f'<rect width="64" height="64" fill="{MASKABLE_GROUND}"/>'
        f'<g transform="translate({offset:.3f} {offset:.3f}) scale({MASKABLE_SCALE})">{body}</g>'
        "</svg>"
    )


def render(svg_bytes, name, size):
    out = ROOT / "icons" / name
    cairosvg.svg2png(bytestring=svg_bytes, write_to=str(out),
                     output_width=size, output_height=size)
    print(f"{out.relative_to(ROOT)}  {size}x{size}  {out.stat().st_size:,} bytes")


def main():
    svg = SOURCE.read_bytes()
    for name, size in TARGETS:
        render(svg, name, size)

    maskable = maskable_svg(svg.decode("utf-8")).encode("utf-8")
    for name, size in MASKABLE_TARGETS:
        render(maskable, name, size)


if __name__ == "__main__":
    main()
