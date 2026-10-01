import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCENE_BOOT_TIMEOUT_MS, waitForSceneRunning } from '../test/phaserScene';
import type { ArtPackManifest } from './artContract';
import { artSheetKey, recoloredSheetKey } from './artPack';
import { ArtPackLoader, type ArtPackLoaderOptions } from './artPackLoader';

/**
 * Browser layer: the loader drives Phaser's real loader against the pack the
 * Vite server serves from `public/assets/pack/`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

async function boot(options: ArtPackLoaderOptions = {}): Promise<{ scene: Phaser.Scene; art: ArtPackLoader }> {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);

  let art!: ArtPackLoader;
  class ProbeScene extends Phaser.Scene {
    constructor() {
      super('probe');
    }
    preload(): void {
      art = new ArtPackLoader(this, options);
      art.preload();
    }
  }

  const game = new Phaser.Game({ type: Phaser.AUTO, parent: host, width: 64, height: 64, scene: [ProbeScene] });
  games.push(game);
  await waitForSceneRunning(game, 'probe');
  return { scene: game.scene.getScene('probe') as Phaser.Scene, art };
}

async function settle(art: ArtPackLoader, pieceId: string): Promise<void> {
  const onSettled = vi.fn();
  art.request(pieceId, onSettled);
  await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1), { timeout: SCENE_BOOT_TIMEOUT_MS, interval: 50 });
}

function withoutPiece(manifest: ArtPackManifest, id: string): ArtPackManifest {
  return { ...manifest, pieces: manifest.pieces.filter((piece) => piece.id !== id) };
}

describe('ArtPackLoader', () => {
  it('reads the manifest and loads what the map draws before create(), cut into contract frames', async () => {
    const { scene, art } = await boot();

    expect(art.manifest?.defaults.desk).toBe('desk-wood');
    const grass = art.sheet('floor-grass', 'sheet');
    expect(grass).toBe(artSheetKey('floor-grass', 'sheet'));
    // Nine 32x32 tiles of the 96x96 motif, plus Phaser's `__BASE`.
    expect(scene.textures.get(grass as string).frameTotal).toBe(10);
    expect(scene.textures.get(grass as string).get(4).width).toBe(32);
    expect(art.sheet('desk-wood', 'sheet')).not.toBeNull();
    expect(art.sheet('chair-leather', 'sheet')).not.toBeNull();
    // Characters are not drawn from the pack yet: nothing downloads them up front.
    expect(art.sheet('character-p01-burgundy-suit', 'walk')).toBeNull();
    expect(scene.textures.exists(artSheetKey('character-p01-burgundy-suit', 'walk'))).toBe(false);
  });

  it('loads a piece on request during the session and tells the caller once it is ready', async () => {
    const { scene, art } = await boot();

    expect(art.request('character-p02-beige-blazer', () => {})).toBe('loading');
    await settle(art, 'character-p02-beige-blazer');

    expect(art.status('character-p02-beige-blazer')).toBe('ready');
    const walk = art.sheet('character-p02-beige-blazer', 'walk') as string;
    expect(scene.textures.get(walk).get(0)).toMatchObject({ width: 32, height: 52 });
    expect(art.sheet('character-p02-beige-blazer', 'seated')).not.toBeNull();
    expect(art.request('character-p02-beige-blazer', () => {})).toBe('ready');
  });

  it('re-reads the catalog for a piece it does not know yet, then loads it', async () => {
    const { art } = await boot();
    const manifest = art.manifest as ArtPackManifest;
    // As if this character had been added to the pack after the page loaded.
    art.adoptManifest(withoutPiece(manifest, 'character-p03-forest-suit'));

    await settle(art, 'character-p03-forest-suit');

    expect(art.status('character-p03-forest-suit')).toBe('ready');
    expect(art.manifest?.pieces.some((piece) => piece.id === 'character-p03-forest-suit')).toBe(true);
  });

  it('marks a piece whose file fails as failed, and never retries it in a loop', async () => {
    const { art } = await boot();
    const manifest = art.manifest as ArtPackManifest;
    const wood = manifest.pieces.find((piece) => piece.id === 'desk-wood');
    if (wood?.kind !== 'desk') throw new Error('missing desk-wood');
    const broken = { ...wood, id: 'desk-broken', files: [{ ...wood.files[0], path: 'desk/does-not-exist.png' }] };
    art.adoptManifest({ ...manifest, pieces: [...manifest.pieces, broken] });

    await settle(art, 'desk-broken');

    expect(art.status('desk-broken')).toBe('failed');
    expect(art.sheet('desk-broken', 'sheet')).toBeNull();
    expect(art.request('desk-broken', () => {})).toBe('failed');
  });

  it('an id the catalog never had fails after one re-read', async () => {
    const { art } = await boot();

    await settle(art, 'desk-from-the-future');

    expect(art.status('desk-from-the-future')).toBe('failed');
  });

  it('recolors a colorable piece once per color and reuses that texture', async () => {
    const { scene, art } = await boot();

    const key = art.sheet('desk-painted', 'sheet', '#c0392b');

    expect(key).toBe(recoloredSheetKey('desk-painted', 'sheet', '#c0392b'));
    const texture = scene.textures.get(key as string);
    expect(texture.get(1)).toMatchObject({ width: 64, height: 64 });
    expect(art.sheet('desk-painted', 'sheet', '#C0392B')).toBe(key);
    expect(scene.textures.get(key as string)).toBe(texture);
    // The exported color and a non-colorable material draw the exported sheet.
    expect(art.sheet('desk-painted', 'sheet', '#4f9a8a')).toBe(artSheetKey('desk-painted', 'sheet'));
    expect(art.sheet('desk-wood', 'sheet', '#c0392b')).toBe(artSheetKey('desk-wood', 'sheet'));
  });

  it('without a manifest the office still boots, with nothing to draw from the pack', async () => {
    const { art } = await boot({ manifestUrl: 'assets/pack/missing-manifest.json' });

    expect(art.manifest).toBeNull();
    expect(art.sheet('floor-grass', 'sheet')).toBeNull();
    await settle(art, 'floor-grass');
    expect(art.status('floor-grass')).toBe('failed');
  });

  it('with the pack turned off it asks for nothing at all', async () => {
    const { art } = await boot({ manifestUrl: null });

    expect(art.manifest).toBeNull();
    expect(art.request('floor-grass', () => {})).toBe('failed');
  });
});
