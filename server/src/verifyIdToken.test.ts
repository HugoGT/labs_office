/**
 * Pruebas de `createIdTokenVerifier` sin red: se genera un par de claves RSA
 * local, se firma con la privada y se resuelve con `createLocalJWKSet` sobre la
 * publica. El verificador acepta el resolvedor de claves por parametro justo
 * para esto; con `createRemoteJWKSet` cada test dependeria de googleapis.com y
 * de su cache, y un fallo de red se leeria como "el token es invalido".
 *
 * Cada rama del contrato tiene su propio caso a proposito: `verify` colapsa
 * todos los motivos de rechazo en `null`, asi que si un solo test cubriese
 * varias, un cambio que rompiese una guarda seguiria pasando gracias a otra.
 */

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createIdTokenVerifier, FIREBASE_JWKS_URL } from './verifyIdToken.ts';

const PROJECT_ID = 'oficina-virtual';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KID = 'clave-de-prueba';

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

let officeKeys: KeyPair;
/** Un segundo par, jamas publicado en el JWKS: sirve para forjar firmas. */
let intruderKeys: KeyPair;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  officeKeys = await generateKeyPair('RS256');
  intruderKeys = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(officeKeys.publicKey);
  keys = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] });
});

/**
 * El logger se silencia salvo donde el test va justamente sobre el: la mitad de
 * estos casos rechaza a proposito y la salida real enterraria el resultado.
 */
function verifier(logFailure: (errorName: string) => void = () => {}) {
  return createIdTokenVerifier({ projectId: PROJECT_ID }, keys, logFailure);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Payload de un ID token de Firebase valido; cada test cambia solo lo suyo. */
function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = nowSeconds();
  return {
    iss: ISSUER,
    aud: PROJECT_ID,
    sub: 'uid-de-ana',
    iat: now - 10,
    auth_time: now - 20,
    exp: now + 3600,
    email: 'ana@example.com',
    name: 'Ana Gomez',
    ...overrides,
  };
}

function sign(
  payload: Record<string, unknown>,
  options: { key?: CryptoKey; alg?: string; kid?: string } = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: options.kid ?? KID })
    .sign(options.key ?? officeKeys.privateKey);
}

describe('FIREBASE_JWKS_URL', () => {
  it('apunta al JWKS publico de securetoken, no al endpoint x509', () => {
    // Google publica las mismas claves en dos formatos. `jose` solo entiende
    // JWK; el endpoint `.../x509/securetoken@system.gserviceaccount.com`
    // devuelve certificados PEM y romperia la resolucion en silencio.
    expect(FIREBASE_JWKS_URL).toBe(
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
    );
  });
});

describe('createIdTokenVerifier: token valido', () => {
  it('devuelve uid, email y name de un token bien firmado', async () => {
    const token = await sign(claims());

    expect(await verifier().verify(token)).toEqual({
      uid: 'uid-de-ana',
      email: 'ana@example.com',
      name: 'Ana Gomez',
    });
  });

  it('deja email y name en null cuando el token no los trae', async () => {
    // Una cuenta creada por telefono o anonima no lleva `email` ni `name`. El
    // uid sigue siendo valido, asi que el token no se rechaza: el que decide
    // que nombre mostrar es `deriveIdentityName` en `OfficeRoom.ts`.
    const token = await sign(claims({ email: undefined, name: undefined }));

    expect(await verifier().verify(token)).toEqual({
      uid: 'uid-de-ana',
      email: null,
      name: null,
    });
  });

  it('descarta un email o un name que no sean texto en vez de propagarlos', async () => {
    // Nada garantiza el tipo de un claim: llega firmado, no validado.
    const token = await sign(claims({ email: 42, name: { nombre: 'Ana' } }));

    expect(await verifier().verify(token)).toEqual({
      uid: 'uid-de-ana',
      email: null,
      name: null,
    });
  });

  it('acepta un token sin auth_time, que es opcional', async () => {
    const token = await sign(claims({ auth_time: undefined }));

    expect((await verifier().verify(token))?.uid).toBe('uid-de-ana');
  });
});

describe('createIdTokenVerifier: rechazos', () => {
  it('rechaza un emisor de otro proyecto', async () => {
    const token = await sign(claims({ iss: 'https://securetoken.google.com/otro-proyecto' }));

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza una audiencia de otro proyecto', async () => {
    const token = await sign(claims({ aud: 'otro-proyecto' }));

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza un token caducado', async () => {
    const now = nowSeconds();
    const token = await sign(claims({ iat: now - 7200, exp: now - 60 }));

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza un token emitido en el futuro', async () => {
    const token = await sign(claims({ iat: nowSeconds() + 600 }));

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza un auth_time en el futuro', async () => {
    const token = await sign(claims({ auth_time: nowSeconds() + 600 }));

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza un sub vacio', async () => {
    const token = await sign(claims({ sub: '' }));

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza un token sin sub: sin uid no hay identidad que ligar a la sesion', async () => {
    const token = await sign(claims({ sub: undefined }));

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza un sub que no es texto', async () => {
    const token = await sign(claims({ sub: 12345 }));

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza una firma hecha con otra clave aunque el kid diga lo contrario', async () => {
    // El `kid` lo escribe quien firma, asi que apunta a la clave buena mientras
    // la firma sale de otra: si el verificador resolviese la clave y no
    // comprobase la firma, este token pasaria.
    const token = await sign(claims(), { key: intruderKeys.privateKey });

    expect(await verifier().verify(token)).toBeNull();
  });

  it('rechaza un token que no es una cadena', async () => {
    const verify = verifier().verify;

    expect(await verifier().verify(undefined)).toBeNull();
    expect(await verifier().verify(null)).toBeNull();
    expect(await verifier().verify(42)).toBeNull();
    expect(await verifier().verify({ token: 'x' })).toBeNull();
    expect(typeof verify).toBe('function');
  });

  it('rechaza una cadena vacia o basura sin lanzar', async () => {
    expect(await verifier().verify('')).toBeNull();
    expect(await verifier().verify('esto-no-es-un-jwt')).toBeNull();
    expect(await verifier().verify('a.b.c')).toBeNull();
  });
});

describe('createIdTokenVerifier: regresion de seguridad (algoritmo)', () => {
  const secret = new TextEncoder().encode('un-secreto-cualquiera-de-32-bytes-o-mas');

  /**
   * Resolvedor complice: devuelve el secreto HMAC para cualquier cabecera, sin
   * mirar `alg` ni `kid`. Existe para que la prueba mida la lista blanca de
   * `algorithms` y no la selectividad de `createLocalJWKSet`: con el JWKS local
   * un HS256 ya muere al resolver la clave, asi que el test pasaria igual
   * aunque alguien borrase `algorithms` de la implementacion.
   */
  const complicitKeys = (async () => secret) as unknown as JWTVerifyGetKey;

  it('REGRESION: rechaza un token firmado con HS256 aunque la clave resuelva', async () => {
    // El ataque clasico de confusion de algoritmo: el JWKS publico de Google es
    // descargable por cualquiera, asi que si el verificador aceptase HMAC,
    // cualquiera podria usar el modulo RSA publico como secreto compartido y
    // firmarse tokens con el uid que quisiera.
    const token = await new SignJWT(claims())
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .sign(secret);

    const complicit = createIdTokenVerifier({ projectId: PROJECT_ID }, complicitKeys, () => {});
    expect(await complicit.verify(token)).toBeNull();
    // Y tambien contra el JWKS de verdad, que es el camino de produccion.
    expect(await verifier().verify(token)).toBeNull();
  });

  it('REGRESION: rechaza un token con alg "none" y firma vacia', async () => {
    // Sin firma no hay nada que verificar: aceptarlo convertiria el ID token en
    // un formulario que el cliente rellena con el uid que quiera.
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims())}.`;

    const complicit = createIdTokenVerifier({ projectId: PROJECT_ID }, complicitKeys, () => {});
    expect(await complicit.verify(token)).toBeNull();
    expect(await verifier().verify(token)).toBeNull();
  });
});

describe('createIdTokenVerifier: rastro para el operador', () => {
  it('registra el nombre del error, nunca el mensaje ni el token', async () => {
    const registrado: string[] = [];
    const token = await sign(claims({ exp: nowSeconds() - 1 }));

    expect(await verifier((name) => registrado.push(name)).verify(token)).toBeNull();

    // `JWTExpired` es el nombre que da `jose`. Lo que importa del caso no es el
    // nombre exacto sino que llegue ALGO: sin esta linea, un JWKS inalcanzable
    // dejaria fuera a toda la oficina sin dejar rastro en el journal.
    expect(registrado).toEqual(['JWTExpired']);
    expect(registrado[0]).not.toContain(token);
  });

  it('no registra nada cuando el token ni siquiera es una cadena', async () => {
    // Aqui no hay error de `jose` que nombrar: se descarta antes de entrar al
    // `try`. Registrarlo solo llenaria el log de ruido de bots.
    const registrado: string[] = [];

    expect(await verifier((name) => registrado.push(name)).verify(undefined)).toBeNull();

    expect(registrado).toEqual([]);
  });
});
