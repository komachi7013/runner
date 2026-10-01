"""Normalize image-generated, chroma-cleaned props to existing gameplay bounds.

Requires Pillow. Source artwork lives in art/props/retro-set; this script only
crops and resizes it. It never draws replacement artwork or infers collisions.
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/props/retro-set'
DEST = ROOT / 'public/assets/props/retro'
SPECS = {
    'spike': ((50, 62), (34, 48), 'hazard', 8),
    'block': ((70, 82), (58, 74), 'solid_platform', 8),
    'floater': ((106, 48), (94, 38), 'solid_platform', 8),
    'storm-cloud': ((145, 76), None, 'lightning_emitter', 14),
    'goal': ((180, 188), None, 'stage_finish_visual', 12),
}

DEST.mkdir(parents=True, exist_ok=True)
manifest = {'style': 'retro hand-painted cel animation', 'generator': 'built-in image_gen', 'props': {}}
for name, (size, body, role, depth) in SPECS.items():
    source = Image.open(SOURCE / f'{name}-clean.png').convert('RGBA')
    alpha = source.getchannel('A')
    # Discard almost invisible key-color residue outside the painted silhouette.
    source.putalpha(alpha.point(lambda value: value if value > 32 else 0))
    box = source.getbbox()
    assert box is not None and box[0] > 0 and box[1] > 0
    assert box[2] < source.width and box[3] < source.height
    crop = source.crop(box)
    # Keep one transparent pixel around the silhouette and the exact original
    # physics texture dimensions. No runtime body-size/scale conversion needed.
    asset = Image.new('RGBA', size)
    asset.paste(crop.resize((size[0] - 2, size[1] - 2), Image.Resampling.LANCZOS), (1, 1))
    assert asset.getchannel('A').getextrema() == (0, 255)
    asset.save(DEST / f'{name}.png', optimize=True)
    manifest['props'][name] = {
        'image': f'{name}.png', 'prompt': f'{name}.prompt.txt',
        'source': f'../../../../art/props/retro-set/{name}-clean.png',
        'sourceCrop': box, 'textureSize': size, 'role': role, 'depth': depth,
        'origin': [0.5, 1] if name == 'goal' else [0.5, 0.5],
        'collisionSize': body,
        'collisionOffset': [(size[0] - body[0]) / 2, (size[1] - body[1]) / 2] if body else None,
        'repeat': 'none', 'qc': {'alpha': True, 'sourceEdgeTouch': False, 'outputEdgeTouch': False},
    }
    print(name, size, 'alpha and containment OK')
(DEST / 'props.json').write_text(json.dumps(manifest, indent=2) + '\n')
