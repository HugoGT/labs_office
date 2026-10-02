# Art templates

Guide PNGs for drawing a piece that passes the upload checks. There is one template per kind, in `docs/art/templates/`. Each template is the exact sheet size that [the contract](contract.md) requires, so the frame grid you draw on is the grid the server checks.

| File | Upload role | Sheet | Frame | Grid (cols x rows) |
|---|---|---|---|---|
| `character-walk.png` | character `walk` | 352x416 | 32x52 | 11 x 8 |
| `character-seated.png` | character `seated` | 352x232 | 44x58 | 8 x 4 |
| `chair.png` | none (pack only) | 144x76 | 36x38 | 4 x 2 |
| `desk.png` | desk `sheet` | 256x64 | 64x64 | 4 x 1 |
| `floor.png` | floor `sheet` | 96x96 | 32x32 | 3 x 3 |
| `plant.png` | plant `sheet` | 32x48 | 32x48 | 1 x 1 |

## How to use a template

1. Open the template in a pixel editor that exports PNG (Aseprite, LibreSprite, Piskel). Set the editor grid to the frame size.
2. Keep the template as the bottom layer and draw on a new layer above it.
3. Before exporting, hide or delete the template layer. Export only your drawing, at 1x, as a PNG.

The guides are meant to be thrown away. If you upload a template with its guides still in it, the server refuses it: a sprite fails the transparent corner rule (`background-present`), and a floor fails the opacity rule (`not-opaque`). The size and the color count of a template already pass, so the only thing to replace is the guide layer.

## What the guides mean

| Guide | Color | Meaning |
|---|---|---|
| Frame border | Magenta line | The edge of each frame. The border pixels are still part of the frame, but the four corner pixels of a sprite frame must stay transparent. |
| Checker | Translucent blue, 4px squares | The drawable area. Use the squares to count pixels. |
| Anchor | Red cross, black center | The black pixel is the exact anchor: the feet, the pelvis on the seat, the seat of a chair, or the floor point of a desk or plant. Keep it at the same place in every frame. |
| Chair ground | Cyan cross, black center | The floor pixel under the seat. A chair and its sitter are depth sorted by it. |
| Footprint | Green dashed line | The tile a plant stands on. The plant anchor is the middle of its bottom edge. |
| Label | Dark text, top left | The place of the frame in the order of its sheet. |

## Frame order

The labels follow the contract's order. Draw each frame in the cell that has its label:

- **Character walk**: one row per direction, `S, SE, E, NE, N, NW, W, SW`. Columns `STEP 0` to `STEP 9` are the walk cycle, and the last column is `IDLE`.
- **Character seated**: one row per facing, `UP, DOWN, LEFT, RIGHT` (the way the sitter looks). Columns `SIT 0` to `SIT 5` sit down, and `IDLE 6` and `IDLE 7` loop while seated.
- **Chair**: one column per facing, `UP, DOWN, LEFT, RIGHT`. Row `BACK` is drawn behind the sitter, and row `FRONT` is drawn in front of them.
- **Desk**: one column per facing, `UP, DOWN, LEFT, RIGHT`. The second line is its footprint in tiles (`2X1` or `1X2`).
- **Floor**: frame `row * 3 + col` is a 32x32 tile of one 96x96 motif. The whole sheet must tile seamlessly and be fully opaque.
- **Plant**: one frame.

## Rules the template cannot show

These checks apply to your exported file. See [the contract](contract.md) for the full list:

- At most 128 distinct colors per file. Use flat pixel art, not gradients or smoothed upscales.
- At most 128 KB per file.
- Sprite frames have transparent corners. Partial alpha is fine for shadows and glass.

## Regenerating

The templates are generated from `src/game/artContract.ts` by `tools/art/domain/templates.ts`. Run `pnpm art:templates` after a contract change and commit the result. `tools/art/templates.test.ts` fails while the committed templates differ from a fresh export. Never edit the PNGs by hand.
