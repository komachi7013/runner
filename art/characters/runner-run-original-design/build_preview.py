"""Assemble generated frames; preserve one scale and contact/flight geometry."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

folder = Path(__file__).resolve().parent
source = Image.open(folder / 'sheet-clean.png').convert('RGBA')
# Normalize the generated 1774x887 canvas to exact equal square source cells.
source = source.resize((2048, 1024), Image.Resampling.LANCZOS)
cell = 384
scale = 0.84 * cell / 512
ground = round(cell * 0.84)
frames = []
info = []
contacts = {0, 1, 2, 4, 5, 6}
parts = [source.crop(((i % 4)*512, (i//4)*512, (i%4+1)*512, (i//4+1)*512)) for i in range(8)]
bottoms = [p.getchannel('A').point(lambda a: a if a > 32 else 0).getbbox()[3] for p in parts]
base = max(bottoms[i] for i in contacts)
dy = [base - b if i in contacts else 0 for i, b in enumerate(bottoms)]
dy[3] = (dy[2] + dy[4]) / 2
dy[7] = (dy[6] + dy[0]) / 2
for i, part in enumerate(parts):
    a = np.array(part)
    r, g, b = (a[:, :, c].astype(float) for c in range(3))
    belt = (r > 110) & (g > 65) & (r > g*1.08) & (g > b*1.4) & (a[:,:,3] > 128)
    belt[:int(512*.42)] = False
    belt[int(512*.56):] = False
    belt[:, :int(512*.32)] = False
    belt[:, int(512*.62):] = False
    yy, xx = np.where(belt)
    assert len(xx) > 10, f'No waist marker in frame {i+1}'
    # The belt is an attached visual root marker. Only translation is applied;
    # never normalize each pose's bounding box, or align airborne feet.
    root_x = float(xx.mean()) - 14
    tx = cell/2 - root_x * scale
    ty = ground - base * scale + dy[i] * scale
    frame = part.transform((cell, cell), Image.Transform.AFFINE,
        (1/scale, 0, -tx/scale, 0, 1/scale, -ty/scale), Image.Resampling.BICUBIC)
    box = frame.getbbox()
    assert box and box[0] > 0 and box[1] > 0 and box[2] < cell and box[3] < cell
    frame.save(folder/f'frame-{i+1:02}.png')
    frames.append(frame)
    info.append({'frame': i+1, 'contact': i in contacts, 'sourceRootX': root_x,
        'translation': [tx, ty], 'alphaBounds': box, 'sharedScale': scale})

sheet = Image.new('RGBA', (cell*4, cell*2))
for i, frame in enumerate(frames):
    sheet.paste(frame, ((i%4)*cell, (i//4)*cell))
sheet.save(folder/'sheet-transparent.png')
magenta = Image.new('RGBA', sheet.size, '#ff00ff')
magenta.alpha_composite(sheet)
magenta.convert('RGB').save(folder/'sheet-magenta.png')

# GIF previews have a neutral solid background; PNGs retain the full alpha.
gif_frames = []
for frame in frames:
    background = Image.new('RGBA', frame.size, '#f3eee4')
    background.alpha_composite(frame)
    gif_frames.append(background.convert('RGB'))
gif_frames[0].save(folder/'run-loop.gif', save_all=True, append_images=gif_frames[1:],
    duration=80, loop=0, disposal=2)
gif_frames[0].save(folder/'run-loop-slow.gif', save_all=True, append_images=gif_frames[1:],
    duration=160, loop=0, disposal=2)
meta = {'frames': 8, 'rows': 2, 'columns': 4, 'cellSize': cell,
    'frameDurationMs': 80, 'fps': 12.5, 'groundY': ground,
    'source': 'raw-sheet.png', 'prompt': 'final.prompt.txt',
    'generator': 'built-in image_gen',
    'referenceNote': 'Original design sheet used at generation time; retired from runtime during cleanup.',
    'gameIntegrated': True, 'runtimeAsset': '../../../public/assets/characters/runner-girl-run-original-design.png', 'alignment': 'waist horizontal root; contact soles only; shared scale',
    'frameData': info}
(folder/'animation.json').write_text(json.dumps(meta, indent=2)+'\n')
print('8 frames, 2x4 sheets, normal/slow loops; no edge clipping.')
