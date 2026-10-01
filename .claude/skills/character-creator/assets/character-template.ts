// Paste inside CUSTOM_CHARACTERS in tools/art/domain/characters.ts. Option values: references/catalog.md.
// The constants (LIGHT_SKIN, WHITE_SHIRT, BLACK_SHOES...) are already defined in that file.
{
  id: 'c01-teal-blazer', // cNN-<look>: next free number, kebab-case, never renamed later
  name: 'Ana', // display name
  // no `source`: only base characters come from base/
  build: 'slim', // 'broad' | 'slim'
  hair: 'bob', // 'messy' | 'spiky' | 'shortCurly' | 'bigCurly' | 'longStraight' | 'ponytail' | 'wavyPonytail' | 'bob'
  top: 'blazer', // 'suit' | 'blazer' | 'shirt' | 'blouse' | 'longCoat'
  bottom: 'pants', // 'pants' | 'widePants' | 'skirt'
  shoes: 'heels', // 'dress' | 'heels'
  accessory: 'tablet', // 'coffee' | 'handbag' | 'laptop' | 'tablet' | 'briefcase' | 'folder' | 'jacketOverShoulder'
  glasses: false,
  earrings: true,
  // darkerHair: true, // brown hair, or hair close to the skin tone
  palette: {
    skin: LIGHT_SKIN, // FAIR_SKIN | LIGHT_SKIN | TAN_SKIN | DEEP_SKIN, or a custom #rrggbb
    hair: '#2a2438',
    top: '#2f8f8a', // jacket, coat, or the shirt/blouse itself
    inner: WHITE_SHIRT, // under the jacket; WHITE_SHIRT when unused (shirt, blouse)
    // tie: '#1f3a5f', // suit and shirt only
    bottom: '#27324a',
    shoes: BLACK_SHOES,
    accessory: '#3a3f4f', // main accessory color
    accessoryDetail: '#8fd3ea', // clasp, sleeve band, page edge, or tablet screen
    // scrunchie: '#f2c230', // ponytail and wavyPonytail only
  },
},
