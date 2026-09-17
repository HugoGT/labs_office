/**
 * Adaptador de Identity Platform (#24). `fetch` se inyecta, igual que en
 * `adminClient.ts` del cliente: el contrato entero -- el flujo OAuth2 de cuenta
 * de servicio, las dos llamadas de Identity Toolkit y la traduccion de errores
 * -- se prueba sin red y sin credenciales reales.
 *
 * Las formas de los endpoints estan CONFIRMADAS contra la referencia REST de
 * Identity Platform y contra la guia de OAuth2 para cuentas de servicio; ver la
 * cabecera de `gcpIdentityAdmin.ts` para las urls exactas y de donde salen.
 */

import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdentityAdminError } from './identityAdminPort.ts';
import {
  createGcpIdentityAdmin,
  identityAdminFromEnv,
  parseServiceAccountKey,
} from './gcpIdentityAdmin.ts';

/**
 * Par RSA de verdad y generado aqui: firmar con `jose` exige una clave que se
 * pueda importar de verdad, y una constante falsa solo probaria el camino de
 * error. 2048 bits es lo que emite GCP.
 */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const CREDENTIALS = {
  type: 'service_account',
  project_id: 'oficina-de-prueba',
  client_email: 'identity-admin@oficina-de-prueba.iam.gserviceaccount.com',
  private_key: PRIVATE_KEY_PEM,
  token_uri: 'https://oauth2.googleapis.com/token',
};

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Cola de respuestas + registro de llamadas. Nada de red, nada de reloj real. */
function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error(`fetch inesperado a ${String(url)}`);
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const tokenOk = () => jsonResponse({ access_token: 'token-de-acceso', expires_in: 3600 });

function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

function headerOf(call: RecordedCall, name: string): string | undefined {
  return (call.init?.headers as Record<string, string> | undefined)?.[name];
}

describe('parseServiceAccountKey', () => {
  it('sin variable devuelve null: es la degradacion documentada, no una averia', () => {
    expect(parseServiceAccountKey(undefined)).toBeNull();
    expect(parseServiceAccountKey('')).toBeNull();
    expect(parseServiceAccountKey('   ')).toBeNull();
  });

  it('devuelve null si el JSON no se puede leer, en vez de reventar el arranque', () => {
    // Un `.env` a medio escribir no puede tumbar el servidor entero: sin esta
    // credencial lo unico que se degrada es crear invitaciones (503).
    expect(parseServiceAccountKey('{no es json')).toBeNull();
    expect(parseServiceAccountKey('"solo un texto"')).toBeNull();
    expect(parseServiceAccountKey('null')).toBeNull();
  });

  it('devuelve null si falta cualquiera de los tres campos que se usan', () => {
    for (const missing of ['project_id', 'client_email', 'private_key']) {
      const partial: Record<string, unknown> = { ...CREDENTIALS };
      delete partial[missing];
      expect(parseServiceAccountKey(JSON.stringify(partial))).toBeNull();
    }
  });

  it('acepta el JSON de una sola linea que escribe office-deploy.sh', () => {
    // El script compacta la clave descargada con `json.dumps(..., separators)`
    // porque un valor multilinea partiria el `.env`. Los saltos de la clave
    // privada viajan escapados como `\n`, que es como el JSON los representa.
    const singleLine = JSON.stringify(CREDENTIALS);
    expect(singleLine).not.toContain('\n');

    const parsed = parseServiceAccountKey(singleLine);

    expect(parsed?.project_id).toBe('oficina-de-prueba');
    expect(parsed?.private_key).toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('cae al token_uri oficial cuando la clave no lo trae', () => {
    const withoutTokenUri: Record<string, unknown> = { ...CREDENTIALS };
    delete withoutTokenUri.token_uri;

    expect(parseServiceAccountKey(JSON.stringify(withoutTokenUri))?.token_uri).toBe(
      'https://oauth2.googleapis.com/token',
    );
  });
});

describe('identityAdminFromEnv', () => {
  it('sin IDENTITY_ADMIN_CREDENTIALS devuelve null (la ruta respondera 503)', () => {
    expect(identityAdminFromEnv({})).toBeNull();
  });

  it('con credenciales validas construye el adaptador', () => {
    const admin = identityAdminFromEnv({ IDENTITY_ADMIN_CREDENTIALS: JSON.stringify(CREDENTIALS) });

    expect(admin).not.toBeNull();
    expect(typeof admin?.createAccount).toBe('function');
    expect(typeof admin?.disableAccount).toBe('function');
  });
});

describe('createGcpIdentityAdmin', () => {
  let now: number;

  beforeEach(() => {
    now = 1_700_000_000_000;
  });

  function admin(responses: (() => Response | Promise<Response>)[]) {
    const { impl, calls } = fakeFetch(responses);
    return {
      calls,
      admin: createGcpIdentityAdmin({
        credentials: parseServiceAccountKey(JSON.stringify(CREDENTIALS))!,
        fetchImpl: impl,
        now: () => now,
      }),
    };
  }

  describe('el token de acceso', () => {
    it('se pide con el flujo JWT-bearer y una asercion firmada con la clave', async () => {
      const { admin: subject, calls } = admin([
        tokenOk,
        () => jsonResponse({ localId: 'uid-nuevo' }),
      ]);

      await subject.createAccount('ana@example.com', 'secreta');

      const token = calls[0];
      expect(token.url).toBe('https://oauth2.googleapis.com/token');
      expect(token.init?.method).toBe('POST');
      expect(headerOf(token, 'Content-Type')).toBe('application/x-www-form-urlencoded');

      const form = new URLSearchParams(String(token.init?.body));
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

      // La asercion se decodifica, no se verifica: lo que hay que demostrar
      // aqui son los claims, y la firma ya la comprueba Google.
      const [, payload] = String(form.get('assertion')).split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
        string,
        unknown
      >;
      expect(claims.iss).toBe(CREDENTIALS.client_email);
      expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
      expect(claims.scope).toBe('https://www.googleapis.com/auth/identitytoolkit');
      expect(claims.iat).toBe(Math.floor(now / 1000));
      // Google rechaza aserciones con mas de una hora de vida.
      expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(3600);
    });

    it('se reutiliza entre operaciones en vez de pedir uno por llamada', async () => {
      // Un token por peticion serian dos viajes a googleapis.com por cada alta
      // y por cada revocacion, y un limite de cuota alcanzable sin motivo.
      const { admin: subject, calls } = admin([
        tokenOk,
        () => jsonResponse({ localId: 'uid-1' }),
        () => jsonResponse({}),
      ]);

      await subject.createAccount('ana@example.com', 'secreta');
      await subject.disableAccount('uid-1');

      expect(calls.filter((call) => call.url.includes('oauth2'))).toHaveLength(1);
    });

    it('se renueva cuando esta a punto de caducar', async () => {
      const { admin: subject, calls } = admin([
        () => jsonResponse({ access_token: 'primero', expires_in: 3600 }),
        () => jsonResponse({ localId: 'uid-1' }),
        () => jsonResponse({ access_token: 'segundo', expires_in: 3600 }),
        () => jsonResponse({}),
      ]);

      await subject.createAccount('ana@example.com', 'secreta');
      now += 3600 * 1000;
      await subject.disableAccount('uid-1');

      expect(calls.filter((call) => call.url.includes('oauth2'))).toHaveLength(2);
      expect(headerOf(calls[3], 'Authorization')).toBe('Bearer segundo');
    });

    it('un fallo al mintarlo es `unavailable`, nunca un error crudo de Google', async () => {
      const { admin: subject } = admin([() => jsonResponse({ error: 'invalid_grant' }, 400)]);

      await expect(subject.createAccount('ana@example.com', 'secreta')).rejects.toMatchObject({
        code: 'unavailable',
      });
    });

    it('no se cachea un token que no llego: el siguiente intento vuelve a pedirlo', async () => {
      const { admin: subject, calls } = admin([
        () => jsonResponse({}, 500),
        tokenOk,
        () => jsonResponse({ localId: 'uid-1' }),
      ]);

      await expect(subject.createAccount('ana@example.com', 'x')).rejects.toBeInstanceOf(
        IdentityAdminError,
      );
      await expect(subject.createAccount('ana@example.com', 'x')).resolves.toBe('uid-1');
      expect(calls.filter((call) => call.url.includes('oauth2'))).toHaveLength(2);
    });
  });

  describe('createAccount', () => {
    it('llama al endpoint de administracion del proyecto y devuelve el localId', async () => {
      const { admin: subject, calls } = admin([tokenOk, () => jsonResponse({ localId: 'uid-ana' })]);

      const uid = await subject.createAccount('ana@example.com', 'contrasena-generada');

      expect(uid).toBe('uid-ana');
      const create = calls[1];
      expect(create.url).toBe(
        'https://identitytoolkit.googleapis.com/v1/projects/oficina-de-prueba/accounts',
      );
      expect(create.init?.method).toBe('POST');
      expect(headerOf(create, 'Authorization')).toBe('Bearer token-de-acceso');
      expect(bodyOf(create)).toEqual({
        email: 'ana@example.com',
        password: 'contrasena-generada',
      });
    });

    it('no manda localId: en una peticion de administracion Google lo asigna', async () => {
      const { admin: subject, calls } = admin([tokenOk, () => jsonResponse({ localId: 'uid-ana' })]);

      await subject.createAccount('ana@example.com', 'x');

      expect(bodyOf(calls[1])).not.toHaveProperty('localId');
    });

    it('EMAIL_EXISTS se traduce a `email-exists` para que la ruta responda 409', async () => {
      const { admin: subject } = admin([
        tokenOk,
        () => jsonResponse({ error: { code: 400, message: 'EMAIL_EXISTS' } }, 400),
      ]);

      const error = await subject.createAccount('ana@example.com', 'x').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IdentityAdminError);
      expect((error as IdentityAdminError).code).toBe('email-exists');
    });

    it('cualquier otro fallo es `unavailable`, sin inventarle un significado', async () => {
      for (const response of [
        () => jsonResponse({ error: { message: 'WEAK_PASSWORD : Password should be...' } }, 400),
        () => jsonResponse({ error: { message: 'PERMISSION_DENIED' } }, 403),
        () => jsonResponse({}, 500),
        () => new Response('<html>algo raro</html>', { status: 200 }),
        () => jsonResponse({ sin: 'localId' }),
      ]) {
        const { admin: subject } = admin([tokenOk, response]);
        await expect(subject.createAccount('ana@example.com', 'x')).rejects.toMatchObject({
          code: 'unavailable',
        });
      }
    });

    it('la red caida tambien es `unavailable`, no una excepcion de fetch suelta', async () => {
      // El llamante solo sabe tratar `IdentityAdminError`; dejar escapar un
      // `TypeError: fetch failed` acabaria en el 500 generico de Express y la
      // ruta no podria compensar la cuenta huerfana.
      const { admin: subject } = admin([
        tokenOk,
        () => Promise.reject(new TypeError('fetch failed')),
      ]);

      await expect(subject.createAccount('ana@example.com', 'x')).rejects.toBeInstanceOf(
        IdentityAdminError,
      );
    });

    it('el mensaje del error NUNCA arrastra la contrasena', async () => {
      // `error.message` acaba en cualquier agregador de logs; misma regla que
      // `verifyIdToken.ts` aplica al token.
      const secreta = 'contrasena-que-jamas-debe-filtrarse';
      const { admin: subject } = admin([tokenOk, () => jsonResponse({}, 500)]);

      const error = (await subject
        .createAccount('ana@example.com', secreta)
        .catch((e: unknown) => e)) as Error;

      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(secreta);
    });
  });

  describe('disableAccount', () => {
    it('marca la cuenta como deshabilitada por su localId', async () => {
      const { admin: subject, calls } = admin([tokenOk, () => jsonResponse({ localId: 'uid-ana' })]);

      await subject.disableAccount('uid-ana');

      const update = calls[1];
      expect(update.url).toBe(
        'https://identitytoolkit.googleapis.com/v1/projects/oficina-de-prueba/accounts:update',
      );
      expect(update.init?.method).toBe('POST');
      expect(bodyOf(update)).toEqual({ localId: 'uid-ana', disableUser: true });
    });

    it('un fallo es `unavailable`, para que la ruta pueda contarlo sin deshacer nada', async () => {
      const { admin: subject } = admin([tokenOk, () => jsonResponse({}, 500)]);

      await expect(subject.disableAccount('uid-ana')).rejects.toMatchObject({
        code: 'unavailable',
      });
    });
  });
});

describe('IdentityAdminError', () => {
  it('se reconoce por el nombre en cualquier traza', () => {
    const error = new IdentityAdminError('email-exists');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('IdentityAdminError');
    expect(error.code).toBe('email-exists');
  });
});
