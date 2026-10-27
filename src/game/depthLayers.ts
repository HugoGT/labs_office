/**
 * Depths of the office scene (#70, #71, #213): the single owner of every
 * Phaser depth that decides who covers whom in the world.
 *
 * The world is one y-sorted band: ground, furniture, trees, walls, the office
 * decor layer and the avatars, each by its bottom edge (an avatar by its
 * feet). A desk or a tree in front of someone covers them, and a chair still
 * covers the table behind it. Every avatar decoration (ring, name pill,
 * status dot) is a child of the avatar container, so it rides the
 * container's depth for free.
 *
 * #70 once gave walking avatars their own band above the world, so no
 * furniture ever covered them; #213 dropped it because someone walking behind
 * a desk was drawn over it. Only seated avatars sorted with the furniture
 * before.
 *
 * HUD overlays (shade, minimap marker, editor ghosts) sit above the world.
 *
 * Every y is clamped to the map height, so an out-of-range coordinate (a
 * stale peer snapshot, a tween overshoot) can never reach the overlays.
 */

import { WORLD_H } from './mapData';

const WORLD_BAND_BASE = 0;

/**
 * Shade over everything outside the local player's space (`spaceFocus.ts`):
 * above the world, so peers out there step back too, and under the HUD.
 */
export const SPACE_SHADE_DEPTH = 90_000;
/**
 * Outlines of the layout editor ("Editar espacios"): above walls, furniture
 * and avatars, so the whole reach of a room or desk shows.
 */
export const LAYOUT_OUTLINE_DEPTH = 99_000;
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

/**
 * Avatars y-sort with the furniture by their feet. A seated one stands on the
 * chair ground (art migration, step 6), so the desk or table in front of it
 * covers its legs, as the pack art expects, and the chair's two layers wrap
 * it: back, sitter, front, all on the same ground point. Someone walking on
 * that same point passes over all three, and over any asset whose bottom
 * edge is under their feet.
 */
const SEATED_BIAS = 0.25;
const CHAIR_FRONT_BIAS = 0.5;
const WALKING_BIAS = 0.75;

/** Depth of a walking avatar whose feet are at `y` (world px). */
export function avatarDepth(y: number): number {
  return worldAssetDepth(y) + WALKING_BIAS;
}

export function chairLayerDepth(groundY: number, layer: 'back' | 'front'): number {
  return worldAssetDepth(groundY) + (layer === 'front' ? CHAIR_FRONT_BIAS : 0);
}

export function seatedAvatarDepth(groundY: number): number {
  return worldAssetDepth(groundY) + SEATED_BIAS;
}

/**
 * Status tint of an assignable desk: a floor marker over the terrain and
 * under the zone labels (2), so it never veils the desk's sitter.
 */
export const DESK_ZONE_DEPTH = 1.75;
