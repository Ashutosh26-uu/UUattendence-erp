"""Makes the web logo files from the university's logo (assets/logo-original.png).

The source is already large, so it is only trimmed (screenshot border removed, tight margins),
never redrawn. Outputs in public/img:
  logo.png              full logo on white
  logo-transparent.png  same with a transparent background
  logo-mark.png         the emblem (seal) only, square, transparent
  favicon.png           64 x 64 emblem for the browser tab

Run: python scripts/prepare-logo.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "logo-original.png"
OUT = ROOT / "public" / "img"
PAD = 24


def transparent(rgb):
    """White background -> transparent, keeping anti-aliased edges (un-premultiplied from white)."""
    p = rgb.astype(float)
    alpha = np.clip((255 - p.min(axis=2)) / 255 * 1.15, 0, 1)
    safe = np.maximum(alpha, 1e-3)[..., None]
    color = np.clip((p - 255 * (1 - alpha[..., None])) / safe, 0, 255)
    return np.dstack([color, alpha * 255]).astype(np.uint8)


def main():
    a = np.asarray(Image.open(SRC).convert("RGB")).copy()
    a[:4, :] = 255  # thin dark screenshot border at the top
    ink = a.min(axis=2) < 215
    # Ignore faint full-width rules (the light grey line under the logo in the screenshot).
    rows = np.where(ink.sum(axis=1) > 0)[0]
    cols = np.where(ink.sum(axis=0) > 0)[0]
    y0, y1, x0, x1 = rows.min(), rows.max(), cols.min(), cols.max()
    logo = a[max(0, y0 - PAD):y1 + PAD + 1, max(0, x0 - PAD):x1 + PAD + 1]

    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(logo).save(OUT / "logo.png", optimize=True)
    rgba = transparent(logo)
    Image.fromarray(rgba).save(OUT / "logo-transparent.png", optimize=True)

    # Emblem = everything left of the first wide empty gap (between the seal and "UNITED").
    used = (logo.min(axis=2) < 215).sum(axis=0) > 0
    x, gap, split = 0, 0, None
    while x < len(used):
        if used[x]:
            if gap > 25 and x > logo.shape[1] * 0.1:
                split = x - gap // 2
                break
            gap = 0
        else:
            gap += 1
        x += 1
    emblem = Image.fromarray(rgba).crop((0, 0, split or int(logo.shape[1] * 0.25), logo.shape[0]))
    emblem = emblem.crop(emblem.getbbox())
    side = max(emblem.size) + 16
    square = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    square.paste(emblem, ((side - emblem.width) // 2, (side - emblem.height) // 2))
    square.save(OUT / "logo-mark.png", optimize=True)
    square.resize((64, 64), Image.LANCZOS).save(OUT / "favicon.png", optimize=True)
    print("logo", logo.shape[1], "x", logo.shape[0], "| emblem", square.size)


if __name__ == "__main__":
    main()
