/**
 * Reglas puras del catalogo de decoracion (#7, slice 4): rango de slot,
 * rotaciones que la base de datos admite, el filtro de `placeable_on_desk` y
 * la normalizacion de slug/nombre. Viven aparte del adaptador por el mismo
 * motivo que `spaceRules.ts`: la ruta HTTP las necesita sin levantar Postgres,
 * y una sola copia evita que la validacion del adaptador y la de la ruta
 * diverjan en silencio.
 */

import { describe, expect, it } from 'vitest';
import {
  DESK_ROTATIONS,
  DESK_SLOT_MAX,
  DESK_SLOT_MIN,
  InvalidAssetError,
  InvalidDeskConfigError,
  assertPlaceableOnDesk,
  assertValidDeskShape,
  assertValidAssetKind,
  assertValidAssetSize,
  assertValidRotation,
  assertValidSlot,
  assertValidTextureKey,
  deriveAssetSlug,
  normalizeAssetName,
  normalizeCreateAssetInput,
  normalizeDeskConfig,
} from './decorRules.ts';

const PLANTA = { id: 'asset-planta', placeableOnDesk: true };
const SOFA = { id: 'asset-sofa', placeableOnDesk: false };
const CATALOG = [PLANTA, SOFA];

describe('assertValidSlot', () => {
  it('acepta los seis slots del escritorio', () => {
    for (let slot = DESK_SLOT_MIN; slot <= DESK_SLOT_MAX; slot++) {
      expect(() => assertValidSlot(slot)).not.toThrow();
    }
  });

  it('el rango es 0..5 inclusive, igual que el CHECK de schema.sql', () => {
    expect(DESK_SLOT_MIN).toBe(0);
    expect(DESK_SLOT_MAX).toBe(5);
  });

  it('rechaza un slot por debajo del rango', () => {
    expect(() => assertValidSlot(-1)).toThrow(InvalidDeskConfigError);
  });

  it('rechaza un slot por encima del rango', () => {
    expect(() => assertValidSlot(6)).toThrow(InvalidDeskConfigError);
  });

  it('rechaza un slot no entero: un body HTTP sin tipar puede mandar 2.5', () => {
    expect(() => assertValidSlot(2.5)).toThrow(InvalidDeskConfigError);
  });

  it('rechaza lo que no es un numero', () => {
    expect(() => assertValidSlot('3' as unknown as number)).toThrow(InvalidDeskConfigError);
    expect(() => assertValidSlot(null as unknown as number)).toThrow(InvalidDeskConfigError);
    expect(() => assertValidSlot(Number.NaN)).toThrow(InvalidDeskConfigError);
  });
});

describe('assertValidRotation', () => {
  it('acepta las cuatro rotaciones que admite el CHECK de schema.sql', () => {
    expect(DESK_ROTATIONS).toEqual([0, 90, 180, 270]);
    for (const rotation of DESK_ROTATIONS) {
      expect(() => assertValidRotation(rotation)).not.toThrow();
    }
  });

  it('rechaza una rotacion fuera de la lista', () => {
    // El pre-chequeo existe para que la ruta conteste 400 en vez de dejar que
    // el CHECK de la base de datos salte y el adaptador acabe en un 500.
    expect(() => assertValidRotation(45)).toThrow(InvalidDeskConfigError);
    expect(() => assertValidRotation(360)).toThrow(InvalidDeskConfigError);
  });

  it('rechaza lo que no es un numero', () => {
    expect(() => assertValidRotation('90' as unknown as number)).toThrow(InvalidDeskConfigError);
  });
});

describe('assertValidAssetKind', () => {
  it('acepta los tres tipos del CHECK de schema.sql', () => {
    expect(() => assertValidAssetKind('furniture')).not.toThrow();
    expect(() => assertValidAssetKind('decor')).not.toThrow();
    expect(() => assertValidAssetKind('plant')).not.toThrow();
  });

  it('rechaza cualquier otro tipo', () => {
    expect(() => assertValidAssetKind('rug')).toThrow(InvalidAssetError);
    expect(() => assertValidAssetKind(7)).toThrow(InvalidAssetError);
  });
});

describe('assertValidAssetSize', () => {
  it('acepta un tamano positivo y entero', () => {
    expect(() => assertValidAssetSize({ w: 1, h: 2 })).not.toThrow();
  });

  it('rechaza ancho o alto cero o negativo', () => {
    expect(() => assertValidAssetSize({ w: 0, h: 2 })).toThrow(InvalidAssetError);
    expect(() => assertValidAssetSize({ w: 2, h: -1 })).toThrow(InvalidAssetError);
  });

  it('rechaza valores no enteros', () => {
    expect(() => assertValidAssetSize({ w: 1.5, h: 2 })).toThrow(InvalidAssetError);
  });
});

describe('assertValidTextureKey', () => {
  it('acepta una clave de textura no vacia', () => {
    expect(() => assertValidTextureKey('plant-small')).not.toThrow();
  });

  it('rechaza la cadena vacia o solo espacios', () => {
    // `texture_key` es lo unico que ata la fila con el sprite que ya trae el
    // bundle: una vacia deja un asset que nadie puede pintar.
    expect(() => assertValidTextureKey('')).toThrow(InvalidAssetError);
    expect(() => assertValidTextureKey('   ')).toThrow(InvalidAssetError);
  });

  it('rechaza lo que no es una cadena', () => {
    expect(() => assertValidTextureKey(42)).toThrow(InvalidAssetError);
  });
});

describe('deriveAssetSlug y normalizeAssetName', () => {
  it('deriva el mismo slug que spaceRules para el mismo nombre', async () => {
    const { deriveSlug } = await import('../spaces/spaceRules.ts');

    expect(deriveAssetSlug('Planta Grande')).toBe(deriveSlug('Planta Grande'));
    expect(deriveAssetSlug('Sillón Café')).toBe(deriveSlug('Sillón Café'));
  });

  it('quita acentos, pasa a minusculas y une con guiones', () => {
    expect(deriveAssetSlug('Planta Grande')).toBe('planta-grande');
    expect(deriveAssetSlug('  Sillón  Café  ')).toBe('sillon-cafe');
  });

  it('el nombre se guarda tal cual, solo recortado: se muestra en el panel', () => {
    expect(normalizeAssetName('  Planta Grande  ')).toBe('Planta Grande');
  });
});

describe('normalizeCreateAssetInput', () => {
  const VALIDO = {
    name: '  Planta Grande  ',
    kind: 'plant' as const,
    textureKey: 'plant-large',
    w: 1,
    h: 1,
    placeableOnDesk: true,
  };

  it('normaliza el nombre y deriva el slug', () => {
    expect(normalizeCreateAssetInput(VALIDO)).toEqual({
      slug: 'planta-grande',
      name: 'Planta Grande',
      kind: 'plant',
      textureKey: 'plant-large',
      w: 1,
      h: 1,
      placeableOnDesk: true,
    });
  });

  it('recorta la clave de textura', () => {
    expect(normalizeCreateAssetInput({ ...VALIDO, textureKey: ' plant-large ' }).textureKey).toBe(
      'plant-large',
    );
  });

  it('un nombre que no deja slug se rechaza', () => {
    // Sin esto la fila entraria con `slug = ''` y el indice unico sobre
    // `lower(slug)` dejaria pasar exactamente uno, al azar del orden de alta.
    expect(() => normalizeCreateAssetInput({ ...VALIDO, name: '///' })).toThrow(InvalidAssetError);
  });

  it('un tipo invalido se rechaza', () => {
    expect(() =>
      normalizeCreateAssetInput({ ...VALIDO, kind: 'rug' as unknown as 'plant' }),
    ).toThrow(InvalidAssetError);
  });

  it('un tamano invalido se rechaza', () => {
    expect(() => normalizeCreateAssetInput({ ...VALIDO, w: 0 })).toThrow(InvalidAssetError);
  });

  it('placeableOnDesk tiene que ser booleano', () => {
    expect(() =>
      normalizeCreateAssetInput({ ...VALIDO, placeableOnDesk: 'si' as unknown as boolean }),
    ).toThrow(InvalidAssetError);
  });
});

describe('assertPlaceableOnDesk', () => {
  it('deja pasar un asset marcado como colocable', () => {
    expect(() => assertPlaceableOnDesk(PLANTA)).not.toThrow();
  });

  it('rechaza uno que no lo esta', () => {
    expect(() => assertPlaceableOnDesk(SOFA)).toThrow(InvalidDeskConfigError);
  });
});

describe('assertValidDeskShape', () => {
  /**
   * Es la mitad de la validacion que NO necesita el catalogo, y existe
   * separada por eso: el adaptador la corre antes de pedir conexion, asi que
   * un slot repetido o una rotacion de 45 grados no cuestan una consulta.
   */
  it('acepta una configuracion bien formada', () => {
    expect(() =>
      assertValidDeskShape([
        { assetId: PLANTA.id, slot: 0, rotation: 0 },
        { assetId: SOFA.id, slot: 1, rotation: 270 },
      ]),
    ).not.toThrow();
  });

  it('no consulta el catalogo: un assetId desconocido pasa esta mitad', () => {
    expect(() =>
      assertValidDeskShape([{ assetId: 'todavia-no-se-sabe', slot: 0, rotation: 0 }]),
    ).not.toThrow();
  });

  it('rechaza slots repetidos, slots fuera de rango y rotaciones invalidas', () => {
    expect(() =>
      assertValidDeskShape([
        { assetId: PLANTA.id, slot: 1, rotation: 0 },
        { assetId: PLANTA.id, slot: 1, rotation: 0 },
      ]),
    ).toThrow(InvalidDeskConfigError);
    expect(() => assertValidDeskShape([{ assetId: PLANTA.id, slot: 9, rotation: 0 }])).toThrow(
      InvalidDeskConfigError,
    );
    expect(() => assertValidDeskShape([{ assetId: PLANTA.id, slot: 0, rotation: 45 }])).toThrow(
      InvalidDeskConfigError,
    );
  });
});

describe('normalizeDeskConfig', () => {
  it('acepta una configuracion vacia: un escritorio se puede dejar pelado', () => {
    expect(normalizeDeskConfig([], CATALOG)).toEqual([]);
  });

  it('devuelve los items validados', () => {
    expect(
      normalizeDeskConfig([{ assetId: PLANTA.id, slot: 0, rotation: 90 }], CATALOG),
    ).toEqual([{ assetId: PLANTA.id, slot: 0, rotation: 90 }]);
  });

  it('rechaza dos items en el mismo slot', () => {
    // El indice unico `(user_id, slot)` de `schema.sql` es la garantia real;
    // esto es la version amable, para que la ruta conteste 400 y no un 500.
    expect(() =>
      normalizeDeskConfig(
        [
          { assetId: PLANTA.id, slot: 2, rotation: 0 },
          { assetId: PLANTA.id, slot: 2, rotation: 90 },
        ],
        CATALOG,
      ),
    ).toThrow(InvalidDeskConfigError);
  });

  it('rechaza un slot fuera de rango', () => {
    expect(() =>
      normalizeDeskConfig([{ assetId: PLANTA.id, slot: 6, rotation: 0 }], CATALOG),
    ).toThrow(InvalidDeskConfigError);
  });

  it('rechaza una rotacion que la base de datos no admite', () => {
    expect(() =>
      normalizeDeskConfig([{ assetId: PLANTA.id, slot: 0, rotation: 45 }], CATALOG),
    ).toThrow(InvalidDeskConfigError);
  });

  it('rechaza un asset que no es colocable en un escritorio', () => {
    expect(() =>
      normalizeDeskConfig([{ assetId: SOFA.id, slot: 0, rotation: 0 }], CATALOG),
    ).toThrow(InvalidDeskConfigError);
  });

  it('rechaza un assetId que no esta en el catalogo', () => {
    // La FK de `schema.sql` tambien lo atraparia, pero como un 23503 que el
    // adaptador no puede distinguir de una averia: aqui es un 400 honesto.
    expect(() =>
      normalizeDeskConfig([{ assetId: 'no-existe', slot: 0, rotation: 0 }], CATALOG),
    ).toThrow(InvalidDeskConfigError);
  });

  it('rechaza un assetId que no es una cadena', () => {
    expect(() =>
      normalizeDeskConfig(
        [{ assetId: 7 as unknown as string, slot: 0, rotation: 0 }],
        CATALOG,
      ),
    ).toThrow(InvalidDeskConfigError);
  });

  it('no acepta que el catalogo decida el orden: conserva el que llego', () => {
    const items = [
      { assetId: PLANTA.id, slot: 3, rotation: 0 },
      { assetId: PLANTA.id, slot: 1, rotation: 180 },
    ];

    expect(normalizeDeskConfig(items, CATALOG).map((item) => item.slot)).toEqual([3, 1]);
  });
});
