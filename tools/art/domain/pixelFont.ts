/**
 * A 3x5 bitmap font for labels drawn inside sprite frames (the art templates, #121). A 32px
 * frame fits seven of these glyphs per line, enough for a direction plus a frame number, and
 * every label is pixels like the rest of the image, so no font file or renderer is involved.
 */
import type { PixelBuffer, Rgba } from './pixelBuffer.ts';

export const GLYPH_WIDTH = 3;
export const GLYPH_HEIGHT = 5;
const LETTER_SPACING = 1;
export const LINE_HEIGHT = GLYPH_HEIGHT + 1;

// One string per glyph: its 5 rows of 3 pixels, top to bottom, separated by spaces ('#' inked).
const GLYPHS: Readonly<Record<string, string>> = {
  A: '.#. #.# ### #.# #.#',
  B: '##. #.# ##. #.# ##.',
  C: '.## #.. #.. #.. .##',
  D: '##. #.# #.# #.# ##.',
  E: '### #.. ##. #.. ###',
  F: '### #.. ##. #.. #..',
  G: '.## #.. #.# #.# .##',
  H: '#.# #.# ### #.# #.#',
  I: '### .#. .#. .#. ###',
  J: '..# ..# ..# #.# .#.',
  K: '#.# #.# ##. #.# #.#',
  L: '#.. #.. #.. #.. ###',
  M: '#.# ### ### #.# #.#',
  N: '##. #.# #.# #.# #.#',
  O: '.#. #.# #.# #.# .#.',
  P: '##. #.# ##. #.. #..',
  Q: '.#. #.# #.# ##. .##',
  R: '##. #.# ##. #.# #.#',
  S: '.## #.. .#. ..# ##.',
  T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###',
  V: '#.# #.# #.# #.# .#.',
  W: '#.# #.# ### ### #.#',
  X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.',
  Z: '### ..# .#. #.. ###',
  '0': '### #.# #.# #.# ###',
  '1': '.#. ##. .#. .#. ###',
  '2': '##. ..# .#. #.. ###',
  '3': '##. ..# .#. ..# ##.',
  '4': '#.# #.# ### ..# ..#',
  '5': '### #.. ##. ..# ##.',
  '6': '.## #.. ### #.# ###',
  '7': '### ..# .#. .#. .#.',
  '8': '### #.# ### #.# ###',
  '9': '### #.# ### ..# ##.',
  ' ': '... ... ... ... ...',
  '-': '... ... ### ... ...',
};

function glyph(char: string): readonly string[] {
  const rows = GLYPHS[char]?.split(' ');
  if (rows === undefined) throw new Error(`The pixel font has no glyph for ${JSON.stringify(char)}`);
  if (rows.length !== GLYPH_HEIGHT || rows.some((row) => row.length !== GLYPH_WIDTH)) throw new Error(`Malformed glyph ${JSON.stringify(char)}`);
  return rows;
}

/** Width in pixels of one line of text. */
export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * (GLYPH_WIDTH + LETTER_SPACING) - LETTER_SPACING;
}

/** Writes one line of text with its top-left corner at (x, y); pixels outside the buffer are dropped. */
export function drawText(buffer: PixelBuffer, x: number, y: number, text: string, color: Rgba): void {
  [...text].forEach((char, index) => {
    const rows = glyph(char);
    const left = x + index * (GLYPH_WIDTH + LETTER_SPACING);
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      for (let col = 0; col < GLYPH_WIDTH; col += 1) {
        if (rows[row]![col] === '#') buffer.setPixel(left + col, y + row, color);
      }
    }
  });
}
