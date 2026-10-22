/**
 * Reglas puras del catalogo de decoracion (#7, slice 4): la normalizacion de
 * slug/nombre y las demas reglas de un asset. Viven aparte del adaptador por el mismo
 * motivo que `spaceRules.ts`: la ruta HTTP las necesita sin levantar Postgres,
 * y una sola copia evita que la validacion del adaptador y la de la ruta
 * diverjan en silencio.
 */

import { describe, expect, it } from 'vitest';
import {
  AssetNameTakenError,
  InvalidAssetError,
  assertValidAssetKind,
  assertValidAssetSize,
  assertValidTextureKey,
  deriveAssetSlug,
  normalizeAssetName,
  normalizeCreateAssetInput,
  normalizeUpdateAssetInput,
} from './decorRules.ts';

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
      aboveAvatars: false,
    });
  });

  it('an asset is normal unless it asks to be drawn above avatars (#71)', () => {
    expect(normalizeCreateAssetInput(VALIDO).aboveAvatars).toBe(false);
    expect(normalizeCreateAssetInput({ ...VALIDO, aboveAvatars: true }).aboveAvatars).toBe(true);
  });

  it('aboveAvatars, when present, must be a boolean (#71)', () => {
    expect(() =>
      normalizeCreateAssetInput({ ...VALIDO, aboveAvatars: 'si' as unknown as boolean }),
    ).toThrow(InvalidAssetError);
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

describe('normalizeUpdateAssetInput (#71)', () => {
  it('marks and unmarks an asset as drawn above avatars', () => {
    expect(normalizeUpdateAssetInput({ aboveAvatars: true })).toEqual({ aboveAvatars: true });
    expect(normalizeUpdateAssetInput({ aboveAvatars: false })).toEqual({ aboveAvatars: false });
  });

  it('rejects a non-boolean flag', () => {
    expect(() => normalizeUpdateAssetInput({ aboveAvatars: 1 as unknown as boolean })).toThrow(
      InvalidAssetError,
    );
  });

  it('rejects an update with nothing to change', () => {
    // An empty body would be a 200 that did nothing, which reads as "saved".
    expect(() => normalizeUpdateAssetInput({})).toThrow(InvalidAssetError);
  });

  it('drops any other field: identity, size and archiving are not editable here', () => {
    const input = { aboveAvatars: true, name: 'Otro', archivedAt: null } as unknown as {
      aboveAvatars: boolean;
    };
    expect(normalizeUpdateAssetInput(input)).toEqual({ aboveAvatars: true });
  });
});

describe('AssetNameTakenError', () => {
  it('es distinguible por instanceof, no por el texto del mensaje', () => {
    const error = new AssetNameTakenError('x');
    expect(error).toBeInstanceOf(AssetNameTakenError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AssetNameTakenError');
  });

  it('NO es un InvalidAssetError: uno es 400 y el otro 409', () => {
    // Misma separacion que `InvalidSpaceError`/`SpaceNameTakenError`. El
    // cuerpo mal escrito no llega a la base de datos; el nombre repetido si
    // llega y lo rechaza un indice. Colapsarlos daria el codigo HTTP
    // equivocado a una de las dos.
    expect(new AssetNameTakenError('x')).not.toBeInstanceOf(InvalidAssetError);
    expect(new InvalidAssetError('x')).not.toBeInstanceOf(AssetNameTakenError);
  });
});
