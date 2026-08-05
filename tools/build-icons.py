#!/usr/bin/env python3
"""Render icons/icon.svg to the raster sizes index.html and manifest.json ask for.

The app itself has no build step and this is not part of one — it is a one-off
regenerator, checked in so the PNGs beside it can be reproduced rather than
being opaque binaries nobody can rebuild. Run it only after editing
icons/icon.svg:

    pip install cairosvg && python3 tools/build-icons.py

apple-touch-icon.png is the one iOS reads when a reader adds Bigu to their
home screen; 192 and 512 are the two sizes the web app manifest declares.
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


def main():
    svg = SOURCE.read_bytes()
    for name, size in TARGETS:
        out = ROOT / "icons" / name
        cairosvg.svg2png(bytestring=svg, write_to=str(out),
                         output_width=size, output_height=size)
        print(f"{out.relative_to(ROOT)}  {size}x{size}  {out.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
