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
import type {
  Asset,
  CreateAssetInput,
  DecorCatalog,
  DeskItem,
  DeskItemInput,
  ListAssetsOptions,
} from './decorPort.ts';
import { normalizeCreateAssetInput, normalizeDeskConfig } from './decorRules.ts';

export interface MemoryDecorOptions {
  /** Catalogo de partida. */
  seed?: readonly Asset[];
  /** Reloj inyectado: sin el, `createdAt`/`archivedAt` dependerian de la hora de la maquina. */
  now?: () => Date;
  /** Generador de ids inyectable, para que un test pueda fijarlos. */
  newId?: () => string;
}

export function createMemoryDecor(options: MemoryDecorOptions = {}): DecorCatalog {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());

  const assets = new Map<string, Asset>();
  /** Fila cruda del escritorio, ANTES de resolver los campos del asset. */
  const desks = new Map<string, { id: string; assetId: string; slot: number; rotation: DeskItem['rotation']; createdAt: Date }[]>();

  for (const seeded of options.seed ?? []) {
    assets.set(seeded.id, { ...seeded });
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
          createdAt: row.createdAt,
        };
      })
      .sort((a, b) => a.slot - b.slot);
  }

  return {
    async listAssets(options: ListAssetsOptions = {}) {
      const all = [...assets.values()];
      return sorted(options.includeArchived ? all : all.filter((a) => a.archivedAt === null));
    },

    async createAsset(input: CreateAssetInput) {
      const normalized = normalizeCreateAssetInput(input);
      const asset: Asset = { id: newId(), ...normalized, archivedAt: null, createdAt: now() };
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
  };
}
