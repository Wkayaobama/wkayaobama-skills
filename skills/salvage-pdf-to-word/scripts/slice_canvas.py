"""Slice a tall canvas PNG into N equal vertical bands for inspection.

Usage:
    slice_canvas.py <in_png> <out_dir> [n_slices]
"""
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # uncap; canvas is intentionally huge


def slice_canvas(in_png: str, out_dir: str, n: int = 6) -> None:
    img = Image.open(in_png)
    w, h = img.size
    band_h = h // n
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    for i in range(n):
        top = i * band_h
        bottom = (i + 1) * band_h if i < n - 1 else h
        crop = img.crop((0, top, w, bottom))
        out = Path(out_dir) / f"slice-{i+1:02d}-y{top}-{bottom}.png"
        crop.save(out, "PNG", optimize=True)
        print(f"slice {i+1}: y {top}-{bottom} -> {out} ({crop.size[0]}x{crop.size[1]} px)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    slice_canvas(sys.argv[1], sys.argv[2], n)
