/**
 * The ramp color model lives in `src/game/artColor.ts` so the office recolors
 * colorable pieces with exactly what the exporter paints them with. This file
 * keeps the generators' import path.
 */
export { darkenRamp, hexToRgba, makeRamp, mixRgba, TONES, type Ramp, type Tone } from '../../../src/game/artColor.ts';
