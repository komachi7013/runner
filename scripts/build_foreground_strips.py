"""Assemble seamless foreground strips from the generated stage scenery plates.

This only crops, mirrors, and fades accepted image-generated artwork. The
mirrored half makes the first and last columns identical at every row.
"""

from pathlib import Path
from PIL import Image, ImageOps

MAP_DIR = Path(__file__).resolve().parents[1] / "public" / "assets" / "map"
STAGES = (
    ("stage-1-meadow.png", "stage-1-foreground.png"),
    ("stage-2-highland.png", "stage-2-foreground.png"),
    ("stage-3-moonlight.png", "stage-3-foreground.png"),
)
TOP, BOTTOM = 580, 770

for source_name, output_name in STAGES:
    with Image.open(MAP_DIR / source_name) as source:
        source = source.convert("RGBA")
        half = source.crop((0, TOP, source.width // 2, BOTTOM))
        strip = Image.new("RGBA", (half.width * 2, half.height))
        strip.paste(half, (0, 0))
        strip.paste(ImageOps.mirror(half), (half.width, 0))

        alpha = Image.new("L", strip.size)
        for y in range(strip.height):
            opacity = round(155 * min(1, y / 65))
            alpha.paste(opacity, (0, y, strip.width, y + 1))
        strip.putalpha(alpha)
        strip.save(MAP_DIR / output_name, optimize=True)

        first = strip.crop((0, 0, 1, strip.height)).tobytes()
        last = strip.crop((strip.width - 1, 0, strip.width, strip.height)).tobytes()
        assert first == last, output_name
