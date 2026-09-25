import { describe, expect, it } from 'vitest';
import {
  AVATAR_BAND_BASE,
  BAND_SPAN,
  LAYOUT_GHOST_DEPTH,
  MINIMAP_MARKER_DEPTH,
  SPECIAL_BAND_BASE,
  avatarDepth,
  specialAssetDepth,
  worldAssetDepth,
} from './depthLayers';
import { WORLD_H } from './mapData';

describe('depthLayers: render bands (#70, #71)', () => {
  it('each band is wide enough for the whole map height, so no band overflows into the next', () => {
    expect(WORLD_H).toBeLessThan(BAND_SPAN);
    expect(worldAssetDepth(WORLD_H)).toBeLessThan(AVATAR_BAND_BASE);
    expect(avatarDepth(WORLD_H)).toBeLessThan(SPECIAL_BAND_BASE);
  });

  it('keeps y-sorting inside each band', () => {
    expect(worldAssetDepth(100)).toBeLessThan(worldAssetDepth(200));
    expect(avatarDepth(100)).toBeLessThan(avatarDepth(200));
    expect(specialAssetDepth(100)).toBeLessThan(specialAssetDepth(200));
  });

  it('a normal asset at the bottom of the map is still below an avatar at the top (#70)', () => {
    expect(worldAssetDepth(WORLD_H)).toBeLessThan(avatarDepth(0));
  });

  it('a special asset at the top of the map is still above an avatar at the bottom (#71)', () => {
    expect(specialAssetDepth(0)).toBeGreaterThan(avatarDepth(WORLD_H));
  });

  it('clamps out-of-range y so a stray coordinate cannot jump into another band', () => {
    expect(worldAssetDepth(-500)).toBe(worldAssetDepth(0));
    expect(avatarDepth(WORLD_H * 10)).toBe(avatarDepth(WORLD_H));
    expect(specialAssetDepth(Number.POSITIVE_INFINITY)).toBe(specialAssetDepth(WORLD_H));
    expect(avatarDepth(Number.NaN)).toBe(avatarDepth(0));
  });

  it('HUD overlays stay above every world band, special assets included', () => {
    expect(MINIMAP_MARKER_DEPTH).toBeGreaterThan(specialAssetDepth(WORLD_H));
    expect(LAYOUT_GHOST_DEPTH).toBeGreaterThan(specialAssetDepth(WORLD_H));
  });
});
