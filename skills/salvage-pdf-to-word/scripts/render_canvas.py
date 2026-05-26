"""Render the source canvas to PNG using pypdfium2.

Usage:
    render_canvas.py <pdf> <out_png> [dpi]

Defaults to 50 DPI for quick inspection. Higher DPI for detail work.
"""
import sys
from pathlib import Path

import pypdfium2 as pdfium


def render(pdf_path: str, out_png: str, dpi: int = 50) -> None:
    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[0]
    scale = dpi / 72.0
    bitmap = page.render(scale=scale)
    img = bitmap.to_pil()
    Path(out_png).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_png, "PNG", optimize=True)
    print(f"rendered {pdf_path} at {dpi} DPI -> {out_png} ({img.size[0]}x{img.size[1]} px)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    pdf = sys.argv[1]
    out = sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 50
    render(pdf, out, dpi)
