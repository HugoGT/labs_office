---
name: character-creator
description: "Trigger: create/edit/new character, pixel character, sprite, walk animation, crear personaje, editar personaje, nuevo personaje. Add or edit procedural pixel-art office characters."
license: Apache-2.0
metadata:
  author: "codeable-labs"
  version: "1.0"
---

## Activation Contract

Load when a user wants to add or change a character (look, colors, hair, outfit, accessory) in this project's 8-direction pixel-art walk style. Every character also gets a 4-facing sit sheet from the same spec (see `references/sitting.md`).

## Hard Rules

- Edit only data in `tools/art/domain/characters.ts`. Touch `rig.ts` or `spriteRenderer.ts` only after the user explicitly approves a new style feature.
- New characters go in `CUSTOM_CHARACTERS`: id `cNN-<look>` (next free number, kebab-case), no `source`.
- Edit existing characters in place. Never rename an `id`: it is the pack piece id `character-<id>` stored in `users.avatar_id`, and the sprite file names.
- Every character in `CHARACTERS` ships in the art pack (`public/assets/pack/`) and becomes selectable for everyone on the next deploy. A pack that drops one retires it (`retired_at`).
- Use only values from `references/catalog.md`. Write colors as `#rrggbb`. Reuse the skin constants unless the user asks for another tone.
- Hair must contrast with skin: set `darkerHair: true` for brown hair or hair close to the skin tone. Keep `top`, `inner` and `tie` visually distinct.
- Ask at most one question, only for essential missing info. Otherwise pick defaults and state them.
- Always preview before reporting. Remove a base character only after explicit confirmation.

## Decision Gates

| Input | Action |
|-------|--------|
| Text description | Map each described part to catalog values |
| Reference image | Read it, then sample hair, skin, top, bottom and shoe colors with python3 PIL `getpixel` |
| Edit existing | Find by id or name, change only the requested fields |
| Feature not in catalog (hat, beard, dress, new accessory) | Stop, explain that it needs a `rig.ts` extension, offer the nearest catalog option |
| First custom character | `tools/art/pack.test.ts` expects the pack characters to equal `BASE_CHARACTERS`; switch that assertion to `CHARACTERS` |
| Remove | Custom: after confirmation. Base: explicit confirmation, then update the 18-character test in `characters.test.ts` |

## Execution Steps

1. Read `references/catalog.md` and the target spec, or `CUSTOM_CHARACTERS` for a new character.
2. Map the request to option values. Fill gaps from `assets/character-template.ts`.
3. Write the spec, then run `pnpm art:export` (regenerates `public/assets/pack/` and `docs/art/preview/`).
4. Read `docs/art/preview/characters.png` (one row per character: idle in the 8 walk directions, then seated idle in the 4 facings). For walk frames and the sit-down frames, Read `public/assets/pack/character/<id>-walk.png` and `<id>-seated.png`.
5. Check: hair vs skin contrast, face and glasses, top/inner/tie separation, accessory visible, silhouette in all 8 directions and both walk rows, and the 4 sit rows (knees forward, feet on the floor, hands on the lap).
6. Adjust and preview again, at most 3 rounds. Then run `pnpm test:server` (runs `tools/**` tests, `pack.test.ts` included) and `pnpm typecheck`. Commit the spec together with the regenerated pack and previews: `pack.test.ts` fails while they drift.

## Output Contract

Return:
- The id and name.
- One line each for build, hair, top, bottom, shoes, accessory, flags and key colors.
- The preview paths (`docs/art/preview/characters.png` and the pack sheets).
- The results of `pnpm test:server` and `pnpm typecheck`.
- Any defaults or approximations used.

## References

- `references/catalog.md`: option values, palette keys per style, skin constants, color tips.
- `references/sitting.md`: sit sheet layout, seat anchor contract, timing, and the walk/idle hash lock.
- `assets/character-template.ts`: commented spec to paste into `CUSTOM_CHARACTERS`.
- `tools/art/domain/characters.ts`: types, shared constants, and the base and custom rosters.
