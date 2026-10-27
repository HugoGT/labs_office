import { describe, expect, it } from 'vitest';
import {
  LAYOUT_GHOST_DEPTH,
  LAYOUT_OUTLINE_DEPTH,
  MINIMAP_MARKER_DEPTH,
  DESK_ZONE_DEPTH,
  SPACE_SHADE_DEPTH,
  avatarDepth,
  chairLayerDepth,
  seatedAvatarDepth,
  worldAssetDepth,
} from './depthLayers';
import { TILE, WORLD_H } from './mapData';

describe('depthLayers: one y-sorted world (#70, #213)', () => {
  it('keeps every y-sorted thing under the overlays', () => {
    expect(avatarDepth(WORLD_H)).toBeLessThan(SPACE_SHADE_DEPTH);
    expect(worldAssetDepth(WORLD_H)).toBeLessThan(SPACE_SHADE_DEPTH);
  });

  it('y-sorts avatars among themselves and assets among themselves', () => {
    expect(worldAssetDepth(100)).toBeLessThan(worldAssetDepth(200));
    expect(avatarDepth(100)).toBeLessThan(avatarDepth(200));
  });

  it('a desk in front of a walking avatar covers it, and one behind it does not (#213)', () => {
    // A desk table facing down sorts by a point 6px south of its middle tile's center.
    const deskDepthY = 400 + 6;
    expect(avatarDepth(deskDepthY - 1)).toBeLessThan(worldAssetDepth(deskDepthY));
    expect(avatarDepth(deskDepthY + 1)).toBeGreaterThan(worldAssetDepth(deskDepthY));
  });

  it('an avatar standing on the bottom edge of an asset is drawn over it', () => {
    expect(avatarDepth(300)).toBeGreaterThan(worldAssetDepth(300));
    expect(avatarDepth(300)).toBeLessThan(worldAssetDepth(301));
  });

  it('clamps out-of-range y so a stray coordinate cannot jump over the overlays', () => {
    expect(worldAssetDepth(-500)).toBe(worldAssetDepth(0));
    expect(avatarDepth(WORLD_H * 10)).toBe(avatarDepth(WORLD_H));
    expect(avatarDepth(Number.POSITIVE_INFINITY)).toBe(avatarDepth(WORLD_H));
    expect(avatarDepth(Number.NaN)).toBe(avatarDepth(0));
  });

  it('the shade outside the own space covers every band, under the HUD overlays', () => {
    expect(SPACE_SHADE_DEPTH).toBeGreaterThan(avatarDepth(WORLD_H));
    expect(SPACE_SHADE_DEPTH).toBeLessThan(MINIMAP_MARKER_DEPTH);
  });

  it('the layout editor outlines stay above walls, furniture and avatars, under its ghost', () => {
    expect(LAYOUT_OUTLINE_DEPTH).toBeGreaterThan(avatarDepth(WORLD_H));
    expect(LAYOUT_OUTLINE_DEPTH).toBeGreaterThan(SPACE_SHADE_DEPTH);
    expect(LAYOUT_OUTLINE_DEPTH).toBeLessThan(LAYOUT_GHOST_DEPTH);
  });

  it('HUD overlays stay above every band', () => {
    expect(MINIMAP_MARKER_DEPTH).toBeGreaterThan(avatarDepth(WORLD_H));
    expect(LAYOUT_GHOST_DEPTH).toBeGreaterThan(MINIMAP_MARKER_DEPTH);
  });
});

describe('depthLayers: chairs and sitters (art migration, step 6)', () => {
  it('a sitter goes between the back and the front layer of its chair', () => {
    const ground = 400;
    expect(chairLayerDepth(ground, 'back')).toBeLessThan(seatedAvatarDepth(ground));
    expect(seatedAvatarDepth(ground)).toBeLessThan(chairLayerDepth(ground, 'front'));
  });

  it('a sitter y-sorts with the world by its feet, so a table or desk in front of it covers its legs', () => {
    // A desk facing down has its sitter 10px north of its middle and its own
    // depth point 6px south of it.
    expect(seatedAvatarDepth(390)).toBeLessThan(worldAssetDepth(406));
    expect(seatedAvatarDepth(406)).toBeGreaterThan(worldAssetDepth(390));
    expect(chairLayerDepth(400, 'front')).toBeLessThan(worldAssetDepth(401));
  });

  it('a walking avatar on the ground of a chair passes over its sitter and its front layer', () => {
    expect(avatarDepth(400)).toBeGreaterThan(chairLayerDepth(400, 'front'));
    expect(avatarDepth(400)).toBeGreaterThan(seatedAvatarDepth(400));
    // Behind the chair, the sitter covers it.
    expect(avatarDepth(399)).toBeLessThan(seatedAvatarDepth(400));
  });

  it('desk zones are floor markers, under the chair and sitter of any desk', () => {
    // The highest a desk chair can be is its area's top row, one tile in.
    expect(DESK_ZONE_DEPTH).toBeLessThan(chairLayerDepth(TILE, 'back'));
    expect(DESK_ZONE_DEPTH).toBeLessThan(seatedAvatarDepth(TILE));
  });
});
