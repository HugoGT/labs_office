/**
 * Render bands of the office scene (#70, #71): the single owner of every
 * Phaser depth that decides who covers whom in the world.
 *
 * Phaser draws by `depth`, so "players always above normal assets" and
 * "special assets above players" are expressed as three stacked bands, each
 * `BAND_SPAN` wide:
 *
 *   - world band   [0, BAND_SPAN): ground, furniture, trees, desk zones and
 *     normal desk decor. Y-sorted by the object's bottom edge, so a chair
 *     still covers the table behind it.
 *   - avatar band  [AVATAR_BAND_BASE, ...): local player and remote peers.
 *     Y-sorted by the feet, so two overlapping avatars still read right. Every
 *     avatar decoration (ring, name pill, status dot) is a child of the avatar
 *     container, so it rides the container's depth for free.
 *   - special band [SPECIAL_BAND_BASE, ...): catalog assets flagged
 *     `aboveAvatars` (#71), which cover any avatar walking through their area.
 *
 * HUD overlays (minimap marker, layout editor ghost) sit above all three.
 *
 * Every y is clamped to the map height before it is added to its band base.
 * `depthLayers.test.ts` pins `WORLD_H < BAND_SPAN`, so the clamp is what makes
 * it impossible for an out-of-range coordinate (a stale peer snapshot, a
 * tween overshoot) to leak into the band above.
 */

import { WORLD_H } from './mapData';

/** Width of one band in world pixels. Must stay above `WORLD_H` (see the test). */
export const BAND_SPAN = 10_000;

const WORLD_BAND_BASE = 0;
export const AVATAR_BAND_BASE = WORLD_BAND_BASE + BAND_SPAN;
export const SPECIAL_BAND_BASE = AVATAR_BAND_BASE + BAND_SPAN;

/** Minimap position marker: only drawn by the minimap camera, always on top. */
export const MINIMAP_MARKER_DEPTH = 99_999;
/** Placement ghost of the layout editor: above anything on the map, marker included. */
export const LAYOUT_GHOST_DEPTH = 100_000;

function clampY(y: number): number {
  if (Number.isNaN(y)) return 0;
  return Math.min(Math.max(y, 0), WORLD_H);
}

/** Depth of a normal world asset whose bottom edge is at `bottomY` (world px). */
export function worldAssetDepth(bottomY: number): number {
  return WORLD_BAND_BASE + clampY(bottomY);
}

/** Depth of an avatar whose feet are at `y` (world px). */
export function avatarDepth(y: number): number {
  return AVATAR_BAND_BASE + clampY(y);
}

/** Depth of a special (`aboveAvatars`) asset whose bottom edge is at `bottomY` (world px). */
export function specialAssetDepth(bottomY: number): number {
  return SPECIAL_BAND_BASE + clampY(bottomY);
}
