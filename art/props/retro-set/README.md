# Retro anime props

The user approved the floating grass-and-stone block as the visual reference.
The spike, ground block, thundercloud and finish gate were then generated
individually with built-in image_gen, using that approved image as a reference.

Runtime PNGs, exact prompts and the size/collision manifest are saved in
`public/assets/props/retro/`. `*-clean.png` files here retain the high-resolution
art after soft chroma-key removal and despill. `*-trimmed.png` files preserve
the cropped artwork before runtime normalization. `gameplay-preview.png` is a
QA arrangement rendered by the actual game, not a background or a level layout.

Run `python3 scripts/build_retro_props.py` from the project root with Pillow
installed to reproduce the runtime assets from the cleaned images. The script
only crops and resizes generated art. Collision rectangles remain defined by
GameScene and retain their existing dimensions. A one-pixel transparent margin
prevents texture edge clipping. The goal label is rendered by Phaser so the
stage number stays dynamic and readable.

The cloud asset replaces the lightning-emitting thundercloud. Clouds painted
into the existing distant scenery remain part of those background images.
