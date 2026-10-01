/**
 * Loads the art pack into a Phaser scene from its manifest (art migration,
 * step 4). The manifest decides every image and frame grid; the rules live in
 * the pure `artPack.ts`, and this class only drives Phaser's loader and texture
 * manager.
 *
 * Three ways a piece arrives:
 *
 *   - At boot: `preload()` reads the manifest and queues the kinds the map
 *     draws at once (`BOOT_PIECE_KINDS`), so `create()` already has them.
 *   - On request: a placement that needs a piece not loaded yet calls
 *     `request()` and redraws when it settles. A piece id the manifest does
 *     not have re-reads the catalog once first: the pack can grow while a page
 *     stays open.
 *   - Recolored: `sheet()` paints a colorable piece in another color once per
 *     material and color, and keeps that texture for every placement after.
 *
 * Nothing here throws at the scene: a manifest or file that fails to load
 * leaves the piece `failed`, and callers keep their visible fallback.
 */

import type Phaser from 'phaser';
import type { ArtPackManifest, ArtPiece } from './artContract';
import {
  ART_PACK_MANIFEST_URL,
  artSheetKey,
  bootLoadRequests,
  findPiece,
  parseArtPackManifest,
  pieceLoadRequests,
  recolorFor,
  recoloredSheetKey,
  type ArtLoadRequest,
} from './artPack';
import { paintRecoloredCanvas, type PaintableImage } from './artRecolorCanvas';

export type ArtPieceStatus = 'ready' | 'loading' | 'failed';

/** What drawing code needs from the loader; `mapBuilder.ts` depends on this, not on the class. */
export interface ArtTextures {
  readonly manifest: ArtPackManifest | null;
  /**
   * Key of a loaded sheet of a piece, recolored when `color` asks for it, or
   * `null` while it is not loaded (or never will be). Never starts a load.
   */
  sheet(pieceId: string, role: string, color?: string | null): string | null;
  /**
   * Starts loading a piece. Answers its status now; when that is `loading`,
   * `onSettled` runs once, after the piece is ready or has failed.
   */
  request(pieceId: string, onSettled: () => void): ArtPieceStatus;
}

export interface ArtPackLoaderOptions {
  /** `null` turns the pack off: every piece is `failed` and the office draws its fallbacks. */
  manifestUrl?: string | null;
}

const MANIFEST_KEY = 'art-pack-manifest';

export class ArtPackLoader implements ArtTextures {
  private readonly scene: Phaser.Scene;
  private readonly manifestUrl: string | null;
  private current: ArtPackManifest | null = null;
  private readonly failed = new Set<string>();
  private readonly waiting = new Map<string, (() => void)[]>();
  /** Ids that already cost one catalog re-read, so an unknown id cannot re-read forever. */
  private readonly reread = new Set<string>();
  private rereadCount = 0;
  private bound = false;

  constructor(scene: Phaser.Scene, options: ArtPackLoaderOptions = {}) {
    this.scene = scene;
    this.manifestUrl = options.manifestUrl === undefined ? ART_PACK_MANIFEST_URL : options.manifestUrl;
  }

  get manifest(): ArtPackManifest | null {
    return this.current;
  }

  /** Goes in the scene's `preload()`: files queued there finish before `create()`. */
  preload(): void {
    if (this.manifestUrl === null) return;
    this.bind();
    this.readManifest(MANIFEST_KEY, this.manifestUrl, (manifest) => {
      if (manifest === null) return;
      for (const request of bootLoadRequests(manifest, this.manifestUrl as string)) this.queue(request);
    });
  }

  /**
   * Adopts a catalog read during the session. It replaces the previous one: a
   * piece the pack no longer lists has no files left to load either, so its
   * placements keep their fallback.
   */
  adoptManifest(manifest: ArtPackManifest): void {
    this.current = manifest;
  }

  status(pieceId: string): ArtPieceStatus {
    if (this.failed.has(pieceId)) return 'failed';
    const piece = this.current === null ? undefined : findPiece(this.current, pieceId);
    if (piece !== undefined && this.isLoaded(piece)) return 'ready';
    return 'loading';
  }

  sheet(pieceId: string, role: string, color: string | null = null): string | null {
    const piece = this.current === null ? undefined : findPiece(this.current, pieceId);
    if (piece === undefined || this.failed.has(pieceId)) return null;
    const key = artSheetKey(pieceId, role);
    if (!this.scene.textures.exists(key)) return null;
    const recolor = recolorFor(piece, color);
    if (recolor === null) return key;
    const recolored = recoloredSheetKey(pieceId, role, recolor.to);
    if (this.scene.textures.exists(recolored) || this.paintRecolored(key, recolored, recolor.from, recolor.to)) return recolored;
    // A browser that cannot read pixels back still shows the piece, in its exported color.
    return key;
  }

  request(pieceId: string, onSettled: () => void): ArtPieceStatus {
    if (this.manifestUrl === null || this.failed.has(pieceId)) return 'failed';
    const piece = this.current === null ? undefined : findPiece(this.current, pieceId);
    if (piece !== undefined && this.isLoaded(piece)) return 'ready';

    const listeners = this.waiting.get(pieceId);
    if (listeners !== undefined) {
      listeners.push(onSettled);
      return 'loading';
    }
    this.waiting.set(pieceId, [onSettled]);
    this.bind();

    if (piece !== undefined) {
      this.loadPiece(piece);
    } else if (!this.reread.has(pieceId)) {
      this.reread.add(pieceId);
      this.rereadCount += 1;
      // A fresh URL too: the browser's cache would hand back the catalog this page already has.
      this.readManifest(`${MANIFEST_KEY}#${this.rereadCount}`, `${this.manifestUrl}?v=${Date.now()}-${this.rereadCount}`, () => {
        const found = this.current === null ? undefined : findPiece(this.current, pieceId);
        if (found === undefined) this.settle(pieceId, true);
        else if (this.isLoaded(found)) this.settle(pieceId, false);
        else this.loadPiece(found);
      });
      this.startLoader();
    } else {
      this.settle(pieceId, true);
    }
    return 'loading';
  }

  private isLoaded(piece: ArtPiece): boolean {
    return piece.files.every((file) => this.scene.textures.exists(artSheetKey(piece.id, file.role)));
  }

  private loadPiece(piece: ArtPiece): void {
    for (const request of pieceLoadRequests(piece, this.manifestUrl as string)) this.queue(request);
    this.startLoader();
  }

  private queue(request: ArtLoadRequest): void {
    if (this.scene.textures.exists(request.key)) return;
    this.scene.load.spritesheet(request.key, request.url, {
      frameWidth: request.frameWidth,
      frameHeight: request.frameHeight,
    });
  }

  /** Outside `preload()` Phaser's loader does not run by itself. */
  private startLoader(): void {
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }

  /**
   * Reads the manifest as text and parses it here. Phaser's JSON file type
   * rethrows a parse error out of its XHR handler, and a missing manifest is
   * exactly that case: an SPA server answers an unknown path with index.html.
   */
  private readManifest(key: string, url: string, then: (manifest: ArtPackManifest | null) => void): void {
    const load = this.scene.load;
    let settled = false;
    const done = (manifest: ArtPackManifest | null): void => {
      if (settled) return;
      settled = true;
      load.off(`filecomplete-text-${key}`, onText);
      load.off('complete', onBatchComplete);
      // The text cache is only a hand-off here; keeping every re-read would grow it for nothing.
      this.scene.cache.text.remove(key);
      then(manifest);
    };
    const onText = (_key: string, _type: string, text: unknown): void => {
      let manifest: ArtPackManifest | null = null;
      try {
        manifest = parseArtPackManifest(JSON.parse(String(text)));
      } catch {
        manifest = null;
      }
      if (manifest !== null) this.adoptManifest(manifest);
      done(manifest);
    };
    // A 404 or a network error never completes the file: the batch ending is the answer.
    const onBatchComplete = (): void => done(null);
    load.on(`filecomplete-text-${key}`, onText);
    load.on('complete', onBatchComplete);
    load.text(key, url);
  }

  /** One pair of loader listeners for every piece; they settle whoever waits on it. */
  private bind(): void {
    if (this.bound) return;
    this.bound = true;
    this.scene.load.on('filecomplete', (key: string) => this.onFileSettled(key, false));
    this.scene.load.on('loaderror', (file: Phaser.Loader.File) => this.onFileSettled(file.key, true));
    // A file that downloads but does not decode (an SPA answering a missing PNG
    // with index.html) fails without a `loaderror`; once the batch is over,
    // whatever is still waiting and not loaded has failed.
    this.scene.load.on('complete', () => {
      for (const pieceId of [...this.waiting.keys()]) {
        const piece = this.current === null ? undefined : findPiece(this.current, pieceId);
        this.settle(pieceId, piece === undefined || !this.isLoaded(piece));
      }
    });
  }

  private onFileSettled(key: string, failed: boolean): void {
    for (const pieceId of [...this.waiting.keys()]) {
      const piece = this.current === null ? undefined : findPiece(this.current, pieceId);
      if (piece === undefined) continue;
      const keys = piece.files.map((file) => artSheetKey(piece.id, file.role));
      if (!keys.includes(key)) continue;
      if (failed) this.settle(pieceId, true);
      else if (this.isLoaded(piece)) this.settle(pieceId, false);
    }
  }

  private settle(pieceId: string, failed: boolean): void {
    if (failed) this.failed.add(pieceId);
    const listeners = this.waiting.get(pieceId) ?? [];
    this.waiting.delete(pieceId);
    for (const listener of listeners) listener();
  }

  /**
   * Paints `sourceKey` in another color into a new texture with the same
   * frame grid. Runs once per material and color: the result is kept in the
   * texture manager under `targetKey`.
   */
  private paintRecolored(sourceKey: string, targetKey: string, from: string, to: string): boolean {
    const source = this.scene.textures.get(sourceKey);
    const image = source.getSourceImage() as PaintableImage;
    const canvas = paintRecoloredCanvas(image, from, to);
    if (canvas === null) return false;
    const texture = this.scene.textures.addCanvas(targetKey, canvas);
    if (texture === null) return false;
    for (const name of source.getFrameNames()) {
      const frame = source.get(name);
      texture.add(name, 0, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight);
    }
    return true;
  }
}
