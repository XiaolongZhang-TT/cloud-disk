#!/usr/bin/env python3
"""Generate macos/Resources/AppIcon.icns for the Tern menu-bar app.

Run with a Python that has Pillow installed (the bundled DSH runtime does):

  /path/to/python3 macos/tools/make-icon.py

The generated .icns is checked in, so building the app does not require
Pillow.  Re-run this script only when the artwork changes.
"""

import os
import subprocess
import sys
import tempfile

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.stderr.write("Pillow is required to generate the icon.\n")
    raise SystemExit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
MACOS = os.path.dirname(HERE)
RESOURCES = os.path.join(MACOS, "Resources")
ICNS = os.path.join(RESOURCES, "AppIcon.icns")

SIZE = 1024


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def make_master():
    # Background: diagonal gradient from deep indigo to teal.
    top = (28, 38, 84)
    bottom = (18, 138, 156)
    background = Image.new("RGB", (SIZE, SIZE))
    pixels = background.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t = (x + y) / (2.0 * SIZE)
            pixels[x, y] = lerp(top, bottom, t)
    background = background.convert("RGBA")

    draw = ImageDraw.Draw(background)

    # Soft highlight blob.
    highlight = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(highlight)
    hdraw.ellipse([-220, -320, 780, 520], fill=(255, 255, 255, 34))
    background = Image.alpha_composite(background, highlight)
    draw = ImageDraw.Draw(background)

    # Cloud: three circles + a rounded base.
    white = (250, 252, 255, 255)
    shadow = (8, 24, 48, 46)
    cx, cy = SIZE // 2, int(SIZE * 0.53)
    cloud_w = int(SIZE * 0.58)

    def cloud_shapes(dx=0, dy=0, color=white):
        r1 = int(cloud_w * 0.30)
        r2 = int(cloud_w * 0.40)
        r3 = int(cloud_w * 0.25)
        draw.ellipse([cx - dx - r2 + 10 + dx, cy - dy - r2 + 10, cx - dx + r2 + 10, cy - dy + r2 + 10], fill=color)
        # (kept simple: the big circle forms the body)

    # Shadow pass.
    base_shadow = int(SIZE * 0.035)
    shadow_color = (10, 26, 52, 60)
    draw.rounded_rectangle([cx - int(cloud_w * 0.46) + base_shadow,
                            cy + int(cloud_w * 0.10) + base_shadow,
                            cx + int(cloud_w * 0.46) + base_shadow,
                            cy + int(cloud_w * 0.40) + base_shadow],
                           radius=int(cloud_w * 0.15), fill=shadow_color)
    draw.ellipse([cx - int(cloud_w * 0.52) + base_shadow,
                  cy - int(cloud_w * 0.46) + base_shadow,
                  cx + int(cloud_w * 0.10) + base_shadow,
                  cy + int(cloud_w * 0.16) + base_shadow], fill=shadow_color)
    draw.ellipse([cx - int(cloud_w * 0.16) + base_shadow,
                  cy - int(cloud_w * 0.58) + base_shadow,
                  cx + int(cloud_w * 0.44) + base_shadow,
                  cy + int(cloud_w * 0.02) + base_shadow], fill=shadow_color)

    # Cloud body.
    draw.rounded_rectangle([cx - int(cloud_w * 0.46), cy + int(cloud_w * 0.10),
                            cx + int(cloud_w * 0.46), cy + int(cloud_w * 0.40)],
                           radius=int(cloud_w * 0.15), fill=white)
    draw.ellipse([cx - int(cloud_w * 0.52), cy - int(cloud_w * 0.46),
                  cx + int(cloud_w * 0.10), cy + int(cloud_w * 0.16)], fill=white)
    draw.ellipse([cx - int(cloud_w * 0.16), cy - int(cloud_w * 0.58),
                  cx + int(cloud_w * 0.44), cy + int(cloud_w * 0.02)], fill=white)

    # Upward arrow inside the cloud, suggesting sync/upload.
    arrow = (24, 96, 132, 255)
    ax, ay = cx, int(cy + cloud_w * 0.26)
    shaft_w = int(cloud_w * 0.08)
    head_w = int(cloud_w * 0.22)
    head_h = int(cloud_w * 0.18)
    draw.rounded_rectangle([ax - shaft_w // 2, ay - int(cloud_w * 0.20),
                            ax + shaft_w // 2, ay + int(cloud_w * 0.20)],
                           radius=shaft_w // 2, fill=arrow)
    draw.polygon([(ax, ay - int(cloud_w * 0.30)),
                  (ax - head_w // 2, ay - int(cloud_w * 0.12)),
                  (ax + head_w // 2, ay - int(cloud_w * 0.12))], fill=arrow)

    # Rounded icon mask (macOS Big Sur style ~22.4% radius).
    mask = rounded_mask(SIZE, int(SIZE * 0.2237))
    output = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    output.paste(background, (0, 0), mask)
    return output


def main():
    master = make_master()
    os.makedirs(RESOURCES, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "AppIcon.iconset")
        os.makedirs(iconset)
        specs = [
            ("icon_16x16.png", 16),
            ("icon_16x16@2x.png", 32),
            ("icon_32x32.png", 32),
            ("icon_32x32@2x.png", 64),
            ("icon_128x128.png", 128),
            ("icon_128x128@2x.png", 256),
            ("icon_256x256.png", 256),
            ("icon_256x256@2x.png", 512),
            ("icon_512x512.png", 512),
            ("icon_512x512@2x.png", 1024),
        ]
        for name, size in specs:
            master.resize((size, size), Image.LANCZOS).save(os.path.join(iconset, name))
        # Also keep a large PNG for documentation / README previews.
        master.resize((512, 512), Image.LANCZOS).save(os.path.join(RESOURCES, "AppIcon.png"))
        rc = subprocess.call(["/usr/bin/iconutil", "-c", "icns", iconset, "-o", ICNS])
        if rc != 0:
            raise SystemExit(f"iconutil failed with {rc}")
    print(f"wrote {ICNS} ({os.path.getsize(ICNS)} bytes)")


if __name__ == "__main__":
    main()
