# Character Option Catalog

Source of truth: `tools/art/domain/characters.ts` (types) and `tools/art/domain/rig.ts` (drawing). Base ids are listed as examples; see them in `docs/art/preview/characters.png`.

## Build

| Value | Look | Examples |
|-------|------|----------|
| `broad` | Wider shoulders and torso, bigger dress shoes, no eyelashes | p01, p05, p09 |
| `slim` | Narrow frame, eyelash pixel in front views | p02, p06, p11 |

## Hair (`hair`)

| Value | Look | Examples |
|-------|------|----------|
| `messy` | Short, tousled tufts | p01, p07, p08, p09, p15 |
| `spiky` | Short, pointed spikes | p03, p13, p14 |
| `shortCurly` | Tight short curls | p05 |
| `bigCurly` | Large round curly volume | p06 |
| `longStraight` | Straight hair down the back | p02, p11, p18 |
| `ponytail` | Straight ponytail with scrunchie | p16, p17 |
| `wavyPonytail` | Thick wavy ponytail with scrunchie | p04, p12 |
| `bob` | Chin-length rounded cut | p10 |

## Top (`top`)

| Value | Look | Palette keys | Examples |
|-------|------|--------------|----------|
| `suit` | Closed jacket, shirt collar, tie, shirt cuffs | `top` jacket, `inner` shirt, `tie` | p01, p05, p14 |
| `blazer` | Open jacket over a top, skin at the wrist | `top` jacket, `inner` top under it; no tie | p02, p04, p10 |
| `shirt` | Shirt with rolled sleeves and tie, no jacket | `top` shirt, `tie`; `inner` unused | p09, p15 |
| `blouse` | Blouse with V neckline showing skin | `top` blouse; `inner` unused | p06, p11, p17 |
| `longCoat` | Long open coat; `bottom` shows in the opening | `top` coat, `inner` top under it | p18 |

Set unused `inner` to `WHITE_SHIRT`. Without `tie`, the tie falls back to `inner` and disappears.

## Bottom (`bottom`) and Shoes (`shoes`)

| Value | Look | Examples |
|-------|------|----------|
| `pants` | Straight trousers | p01, p10, p12 |
| `widePants` | Wide-leg trousers | p02, p06, p17 |
| `skirt` | Pencil skirt with bare legs | p04, p11, p16, p18 |
| `dress` (shoes) | Flat dress shoes | p01, p03 |
| `heels` (shoes) | Heels | p02, p04 |

## Accessory (`accessory`), held in the right hand

| Value | `accessory` color | `accessoryDetail` color | Examples |
|-------|-------------------|-------------------------|----------|
| `coffee` | Cup | Sleeve band | p01, p07, p13 |
| `handbag` | Bag | Clasp | p02, p12, p18 |
| `laptop` | Body | Seam line | p03 |
| `tablet` | Case | Screen (default `#8fd3ea`) | p04, p10, p17 |
| `briefcase` | Case | Clasp | p05, p08, p14 |
| `folder` | Cover | Page edge | p06, p11, p16 |
| `jacketOverShoulder` | Jacket | Unused | p09, p15 |

## Flags

| Field | Effect |
|-------|--------|
| `glasses` | Dark frames and light lenses; one skin pixel between the frames is drawn automatically |
| `earrings` | Gold earrings (fixed color) |
| `darkerHair` | Draws the whole hair ramp one tone darker |
| `palette.scrunchie` | Scrunchie color, used only by `ponytail` and `wavyPonytail`; defaults to the hair color |

## Shared Constants (in `characters.ts`)

| Constant | Hex |
|----------|-----|
| `FAIR_SKIN` | `#f7d2b0` |
| `LIGHT_SKIN` | `#f4c9a4` |
| `TAN_SKIN` | `#c98b62` |
| `DEEP_SKIN` | `#7c4b33` |
| `WHITE_SHIRT` | `#f3efe6` |
| `BLACK_SHOES` | `#262130` |
| `BROWN_SHOES` | `#7a4527` |

## Color Tips

- Each hex is the base tone. The renderer derives outline, deep, shadow and light tones automatically.
- Hair is lit from above, so most hair pixels use the light tone. To darken hair visibly, set `darkerHair: true` rather than only darkening the hex.
- Use `darkerHair: true` for brown hair, or for any hair within a few shades of the skin.
- Keep `top` versus `inner`, and `tie` versus `inner`, clearly different in value, not just in hue.
- Very dark colors (lightness under about 15%) lose their shading. Very light pastels lose their outline contrast.
- The lanyard, badge, belt and earrings use fixed colors.
