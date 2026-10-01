# Sitting Sprites and the Seat Contract

Every character gets a sit sheet automatically from `buildCharacterSprites(spec).sit`. Nothing is set per character: the pose, the anchor and the frame layout are shared. Source: `tools/art/domain/sitCycle.ts` (pose, layout, anchor), `tools/art/domain/rig.ts` (seated scene), `tools/art/domain/seating.ts` (chair contract).

## Sheet Layout

| Item | Value |
|------|-------|
| Columns | `SIT_FRAME_COUNT` = 8: sit-down frames 0-5 (`SIT_DOWN_FRAME_COUNT`), then seated idle frames 6-7 (`SIT_IDLE_FRAME_COUNT`) |
| Rows | `SIT_ROWS` = chair facings `up` (N), `down` (S), `left` (W), `right` (E) |
| Cell | `SIT_FRAME_WIDTH` x `SIT_FRAME_HEIGHT` = 44 x 58; `sitFrameRect(facing, column)` returns it |
| Frame 0 | The standing idle frame, pixel for pixel, with its feet at `SIT_ANCHOR + STAND_OFFSET[facing]` |
| Frame 5 | Fully seated; same drawing as idle frame 6 |
| Timing | `SIT_DOWN_FRAME_MS` = 90 per sit-down frame; `SIT_IDLE_FRAME_MS` = 900 and 700 for the idle loop |

Play frames 0-5 to sit down, 5-0 to stand up. Loop 6-7 while seated.

## Seat Anchor

| Constant | Meaning |
|----------|---------|
| `SIT_ANCHOR_X`, `SIT_ANCHOR_Y` = (22, 42) | Pixel of every seated frame (5, 6, 7) where the pelvis rests on the seat |
| `SEAT_HEIGHT` = 9 | Screen pixels from the floor under the seat to that point; chairs draw legs this long |
| `STAND_OFFSET` | Feet anchor before sitting, from the seat point: up (0, 6), down (0, 12), left (-9, 9), right (9, 9) |

Draw a sitter at `chair origin + seat - SIT_ANCHOR`: chair `back` layer, then the sit cell, then chair `front` layer.

## Checks for a New or Edited Character

- After `pnpm art:export`, Read `public/assets/pack/character/<id>-seated.png` (every frame, 4 rows) and the seated column of `docs/art/preview/characters.png`: knees forward, feet on the floor, hands on the lap, accessory visible.
- Laptop and briefcase leave the hand when seated (lap and floor); folder and jacketOverShoulder keep their standing hold.
- `tools/art/domain/spriteSheet.test.ts` locks the walk and idle pixels of the base characters by hash. Editing a base character's look changes its hash: update only that line, and only for an intended change.
