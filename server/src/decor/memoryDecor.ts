/**
 * Adaptador de `DecorCatalog` en memoria (#7, slice 4). Mismo papel y misma
 * justificacion que `memorySpaces.ts` y `memoryDirectory.ts`: no es un mock de
 * conveniencia, es el segundo adaptador del puerto.
 *
 * Existe porque las rutas de esta slice tienen salidas de error que solo valen
 * algo si se recorren de verdad -- 400 por slot repetido, por rotacion
 * invalida o por asset no colocable, y 404 por archivar un id que no existe --
 * y un doble que devolviese siempre lo que al test le conviene no recorreria
 * ninguna. Comparte `decorRules.ts` con `pgDecor.ts` para que los dos validen
 * lo mismo y deriven el mismo slug: sin eso, una ruta probada contra este
 * adaptador no diria nada sobre la misma ruta corriendo contra Postgres.
 *
 * La regla de archivados de D1b se reproduce EXACTA y no aproximada, por la
 * misma razon: `listAssets` filtra, `getDeskConfig` no, y la validacion de
 * `replaceDeskConfig` tampoco. Un test que pasa contra memoria y falla contra
 * Postgres es peor que ningun test.
 *
 * Lo que NO reproduce es el arbitraje real de la concurrencia: aqui no hay
 * transaccion, solo un `Map` de un hilo. Es la misma diferencia que ya hay
 * entre `memorySpaces` y `EXCLUDE USING gist`, y es aceptable por lo mismo: lo
 * que estas pruebas cubren es la traduccion a HTTP, no el aislamiento del
 * motor.
 *
 * `seed` y `newId` NO son del puerto: son afordancias de este adaptador para
 * los tests, igual que en `memorySpaces.ts`.
 */

import { randomUUID } from 'node:crypto';
import { ART_CONTRACT_VERSION, artSheetKey, type ArtPackManifest } from '../../../src/game/artContract.ts';
import { ArtPieceExistsError, artPieceFields, assertUploadedArtPiece, normalizeArtPack, packDecorAsset } from './artCatalogRules.ts';
import {
  CONTRIBUTION_QUOTA_WINDOW_MS,
  assertContributionQuota,
  retireTransition,
  reviewTransition,
  type ArtAuditAction,
  type ContributionUsage,
} from './artReviewRules.ts';
import type {
  ArtAuditEntry,
  ArtCatalogPiece,
  ArtContributionInput,
  ArtRetirementInput,
  ArtReviewInput,
  Asset,
  CreateAssetInput,
  DecorCatalog,
  DeskItem,
  DeskItemInput,
  ListArtPiecesOptions,
  ListAssetsOptions,
  ListUploadedArtOptions,
  UpdateAssetInput,
  UploadedArtPieceInput,
} from './decorPort.ts';
import {
  AssetNameTakenError,
  normalizeCreateAssetInput,
  normalizeDeskConfig,
  normalizeUpdateAssetInput,
} from './decorRules.ts';

export interface MemoryDecorOptions {
  /** Catalogo de partida. */
  seed?: readonly Asset[];
  /** Reloj inyectado: sin el, `createdAt`/`archivedAt` dependerian de la hora de la maquina. */
  now?: () => Date;
  /** Generador de ids inyectable, para que un test pueda fijarlos. */
  newId?: () => string;
}

/** The adapter plus what only tests read: the art audit trail, which the port does not expose. */
export interface MemoryDecor extends DecorCatalog {
  artAuditLog(): ArtAuditEntry[];
}

/** Review fields of a piece that is approved from the start: the pack's and an Admin upload's. */
const APPROVED_FROM_THE_START = {
  status: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  licenseAcceptedAt: null,
} as const;

export function createMemoryDecor(options: MemoryDecorOptions = {}): MemoryDecor {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());

  const assets = new Map<string, Asset>();
  /** Fila cruda del escritorio, ANTES de resolver los campos del asset. */
  const desks = new Map<string, { id: string; assetId: string; slot: number; rotation: DeskItem['rotation']; createdAt: Date }[]>();

  for (const seeded of options.seed ?? []) {
    assets.set(seeded.id, { ...seeded });
  }

  /** Art pieces (pack and uploads) by id. Never shrinks: retiring only sets `retiredAt`. */
  const artPieces = new Map<string, ArtCatalogPiece>();
  /** The `audit_log` rows of art transitions, in order. */
  const audit: ArtAuditEntry[] = [];

  function record(actorId: string, action: ArtAuditAction, pieceId: string, at: Date): void {
    audit.push({ actorId, action, pieceId, at });
  }

  /** Same counts as the pg query: pending rows, and `submit-art` entries inside the window. */
  function usageOf(userId: string, at: Date): ContributionUsage {
    const since = at.getTime() - CONTRIBUTION_QUOTA_WINDOW_MS;
    let pending = 0;
    for (const piece of artPieces.values()) if (piece.uploadedBy === userId && piece.status === 'pending') pending += 1;
    const lastHour = audit.filter((entry) => entry.actorId === userId && entry.action === 'submit-art' && entry.at.getTime() > since).length;
    return { pending, lastHour };
  }

  /** An upload by id, whatever its status; pack pieces are not reviewed or retired by hand. */
  function uploadedPiece(id: string): ArtCatalogPiece | null {
    const piece = artPieces.get(id);
    return piece === undefined || piece.source !== 'upload' ? null : piece;
  }

  function byRegistration(list: readonly ArtCatalogPiece[]): ArtCatalogPiece[] {
    return [...list].sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime() || a.id.localeCompare(b.id));
  }

  /** Mismo orden que `pgDecor`: (kind, slug, id). */
  function sorted(list: readonly Asset[]): Asset[] {
    return [...list].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id),
    );
  }

  /**
   * Cruza la fila con su asset, SIN mirar `archivedAt`: es el equivalente del
   * `JOIN assets` sin filtro de `pgDecor.getDeskConfig` (D1b).
   */
  function resolve(userId: string): DeskItem[] {
    return (desks.get(userId) ?? [])
      .map((row) => {
        const asset = assets.get(row.assetId)!;
        return {
          id: row.id,
          assetId: row.assetId,
          slot: row.slot,
          rotation: row.rotation,
          textureKey: asset.textureKey,
          w: asset.w,
          h: asset.h,
          name: asset.name,
          aboveAvatars: asset.aboveAvatars,
          createdAt: row.createdAt,
        };
      })
      .sort((a, b) => a.slot - b.slot);
  }

  /**
   * Validates a new asset and builds its row without writing it, so an upload
   * can check its decor asset before touching either map (the ROLLBACK of
   * `pgDecor.registerUploadedArtPiece`).
   */
  function prepareAsset(input: CreateAssetInput): Asset {
    const normalized = normalizeCreateAssetInput(input);

    // El equivalente de `assets_slug_unique`, sobre `lower(slug)`. Se
    // reproduce por la misma razon que la regla de archivados de D1b: las
    // rutas se prueban contra ESTE adaptador, asi que un alta que aqui
    // pasase y en Postgres diese 500 dejaria la suite certificando un
    // comportamiento que produccion no tiene.
    //
    // Recorre el catalogo ENTERO y no solo lo vivo: el indice de
    // `schema.sql` no es parcial, asi que una pieza retirada sigue ocupando
    // su slug. Filtrar por `archivedAt` aqui daria por buena un alta que la
    // base de datos rechaza.
    //
    // Solo el slug y no tambien el nombre, al reves que `memorySpaces`:
    // `assets` tiene UN indice y no dos. Anadir aqui una comprobacion de
    // nombre rechazaria altas que Postgres acepta, que es el mismo desfase
    // en la otra direccion.
    const slug = normalized.slug.toLowerCase();
    for (const existing of assets.values()) {
      if (existing.slug.toLowerCase() === slug) {
        throw new AssetNameTakenError('ya existe un asset con ese nombre');
      }
    }

    return { id: newId(), ...normalized, archivedAt: null, createdAt: now() };
  }

  return {
    async listAssets(options: ListAssetsOptions = {}) {
      const all = [...assets.values()];
      return sorted(options.includeArchived ? all : all.filter((a) => a.archivedAt === null));
    },

    async createAsset(input: CreateAssetInput) {
      const asset = prepareAsset(input);
      assets.set(asset.id, asset);
      return asset;
    },

    async archiveAsset(id: string) {
      const current = assets.get(id);
      if (!current) return null;

      // La fila se conserva y las colocaciones NO se tocan (D1b). Reproducir
      // aqui un borrado seria dar por buena una ruta que en Postgres chocaria
      // con el `ON DELETE RESTRICT` de la FK.
      const archived: Asset = { ...current, archivedAt: now() };
      assets.set(id, archived);
      return archived;
    },

    async updateAsset(id: string, input: UpdateAssetInput) {
      // Validated before the lookup, same order as `pgDecor`: a bad body is a
      // 400 whether or not the id exists.
      const normalized = normalizeUpdateAssetInput(input);
      const current = assets.get(id);
      if (!current) return null;

      const updated: Asset = { ...current, ...normalized };
      assets.set(id, updated);
      return updated;
    },

    async getDeskConfig(userId: string) {
      return resolve(userId);
    },

    async replaceDeskConfig(userId: string, items: readonly DeskItemInput[]) {
      // El catalogo se pasa ENTERO y sin filtrar archivados, igual que la
      // consulta de validacion de `pgDecor`: lo retirado hay que poder MIRARLO
      // para decidir, no esconderlo. Y junto a el va el escritorio ACTUAL de
      // esta persona, leido antes de tocar nada, que es lo que distingue
      // conservar una pieza retirada de volver a anadirla (D1b).
      //
      // La retencion es por escritorio y no global: se lee el de `userId`, no
      // todos. Que otra persona tenga puesta la pieza no da derecho a ponersela.
      const alreadyPlaced = (desks.get(userId) ?? []).map((row) => row.assetId);
      const normalized = normalizeDeskConfig(items, [...assets.values()], alreadyPlaced);

      // El estado solo se toca cuando ya no queda nada que pueda fallar: es lo
      // que hace el ROLLBACK de `pgDecor`, y sin esto un rechazo dejaria el
      // escritorio a medias.
      const at = now();
      desks.set(
        userId,
        normalized.map((item) => ({ id: newId(), ...item, createdAt: at })),
      );
      return resolve(userId);
    },

    async registerArtPack(pack: ArtPackManifest) {
      // Validated before any write, like the ROLLBACK of `pgDecor`: an
      // invalid pack leaves the catalog as it was.
      const valid = normalizeArtPack(pack);
      const at = now();
      const shipped = new Set<string>();

      for (const piece of valid.pieces) {
        shipped.add(piece.id);
        const fields = artPieceFields(piece);
        const current = artPieces.get(piece.id);
        // Same condition as the `WHERE` of the pg upsert: an unchanged, active
        // piece is left alone, so registering at every start is a no-op.
        const unchanged =
          current !== undefined &&
          current.retiredAt === null &&
          current.contractVersion === valid.contractVersion &&
          JSON.stringify(current.spec) === JSON.stringify(fields.spec);
        if (unchanged) continue;
        artPieces.set(piece.id, {
          ...fields,
          // The kind is kept from the first registration, like pg: the id prefix fixes it.
          kind: current?.kind ?? fields.kind,
          contractVersion: valid.contractVersion,
          retiredAt: null,
          registeredAt: current?.registeredAt ?? at,
          updatedAt: at,
          source: 'pack',
          uploadedBy: null,
          ...APPROVED_FROM_THE_START,
        });
      }

      const retired: string[] = [];
      for (const piece of artPieces.values()) {
        // Uploads are not the pack's to retire (#121): same `source = 'pack'` as pg.
        if (piece.source !== 'pack' || piece.retiredAt !== null || shipped.has(piece.id)) continue;
        artPieces.set(piece.id, { ...piece, retiredAt: at, updatedAt: at });
        retired.push(piece.id);
      }

      // Same as the pg statements: a pack chair gets its decor asset once, by
      // texture key and whatever its archive state, so neither a restart nor
      // an admin's archive is undone; a name already taken skips it instead of
      // stopping the start. A retired piece's asset is archived like a retired plant's.
      for (const piece of valid.pieces) {
        const input = packDecorAsset(piece);
        if (input === null || [...assets.values()].some((entry) => entry.textureKey === input.textureKey)) continue;
        try {
          const created = prepareAsset(input);
          assets.set(created.id, created);
        } catch (error) {
          if (!(error instanceof AssetNameTakenError)) throw error;
        }
      }
      const retiredKeys = new Set(retired.map((id) => artSheetKey(id, 'sheet')));
      for (const entry of assets.values()) {
        if (retiredKeys.has(entry.textureKey) && entry.archivedAt === null) assets.set(entry.id, { ...entry, archivedAt: at });
      }

      return { registered: valid.pieces.length, retired };
    },

    async listArtPieces(options: ListArtPiecesOptions = {}) {
      // Only approved pieces are the catalog (#122): a contribution under
      // review is not choosable, retired or not.
      const all = [...artPieces.values()].filter((piece) => piece.status === 'approved');
      return (options.includeRetired ? all : all.filter((piece) => piece.retiredAt === null)).sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
      );
    },

    async registerUploadedArtPiece({ piece, uploadedBy, decorAsset }: UploadedArtPieceInput) {
      assertUploadedArtPiece(piece);
      // Everything that can fail runs before either map is written.
      if (artPieces.has(piece.id)) throw new ArtPieceExistsError(piece.id);
      const asset = decorAsset === undefined ? null : prepareAsset(decorAsset);
      const at = now();
      const stored: ArtCatalogPiece = {
        ...artPieceFields(piece),
        contractVersion: ART_CONTRACT_VERSION,
        retiredAt: null,
        registeredAt: at,
        updatedAt: at,
        source: 'upload',
        uploadedBy,
        ...APPROVED_FROM_THE_START,
      };
      artPieces.set(piece.id, stored);
      if (asset !== null) assets.set(asset.id, asset);
      record(uploadedBy, 'upload-art', piece.id, at);
      return { piece: stored, asset };
    },

    async artContributionUsage(userId: string) {
      return usageOf(userId, now());
    },

    async submitArtContribution({ piece, submittedBy, decorAsset }: ArtContributionInput) {
      // No `await` from the count to the write: on this single thread that is
      // what the per-user lock of pg is, so parallel calls cannot both take
      // the last slot.
      assertUploadedArtPiece(piece);
      const at = now();
      assertContributionQuota(usageOf(submittedBy, at));
      if (artPieces.has(piece.id)) throw new ArtPieceExistsError(piece.id);
      // Only checked: the asset itself is created by the approval.
      if (decorAsset !== undefined) prepareAsset(decorAsset);
      const stored: ArtCatalogPiece = {
        ...artPieceFields(piece),
        contractVersion: ART_CONTRACT_VERSION,
        retiredAt: null,
        registeredAt: at,
        updatedAt: at,
        source: 'upload',
        uploadedBy: submittedBy,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        licenseAcceptedAt: at,
      };
      artPieces.set(piece.id, stored);
      record(submittedBy, 'submit-art', piece.id, at);
      return stored;
    },

    async listUploadedArtPieces(options: ListUploadedArtOptions = {}) {
      return byRegistration(
        [...artPieces.values()].filter(
          (piece) =>
            piece.source === 'upload' &&
            (options.uploadedBy === undefined || piece.uploadedBy === options.uploadedBy) &&
            (options.status === undefined || piece.status === options.status),
        ),
      );
    },

    async findUploadedArtPiece(id: string) {
      return uploadedPiece(id);
    },

    async findArtPiecesWithFile(sha256: string) {
      return byRegistration(
        [...artPieces.values()].filter((piece) => piece.source === 'upload' && piece.files.some((file) => file.sha256 === sha256)),
      );
    },

    async reviewArtContribution({ id, reviewerId, decision, note, decorAsset }: ArtReviewInput) {
      const current = uploadedPiece(id);
      if (current === null) return null;
      const status = reviewTransition(current.status, decision);
      const asset = status === 'approved' && decorAsset !== undefined ? prepareAsset(decorAsset) : null;
      const at = now();
      const reviewed: ArtCatalogPiece = {
        ...current,
        status,
        reviewedBy: reviewerId,
        reviewedAt: at,
        reviewNote: status === 'rejected' ? note : null,
        updatedAt: at,
      };
      artPieces.set(id, reviewed);
      if (asset !== null) assets.set(asset.id, asset);
      record(reviewerId, status === 'approved' ? 'approve-art' : 'reject-art', id, at);
      return { piece: reviewed, asset };
    },

    async retireUploadedArtPiece({ id, actorId }: ArtRetirementInput) {
      const current = uploadedPiece(id);
      if (current === null) return null;
      if (retireTransition(current) === 'already-retired') return { piece: current, changed: false };
      const at = now();
      const retired: ArtCatalogPiece = { ...current, retiredAt: at, updatedAt: at };
      artPieces.set(id, retired);
      // Same UPDATE as pg: the decor asset drawing it stops being offered.
      const textureKey = artSheetKey(id, 'sheet');
      for (const entry of assets.values()) {
        if (entry.textureKey === textureKey && entry.archivedAt === null) assets.set(entry.id, { ...entry, archivedAt: at });
      }
      record(actorId, 'retire-art', id, at);
      return { piece: retired, changed: true };
    },

    artAuditLog() {
      return audit.map((entry) => ({ ...entry }));
    },
  };
}
