/**
 * Adaptador de `IdentityAdmin` contra la API REST de Identity Platform (#24).
 * Habla HTTP, firma un JWT y nada mas: no conoce Express, ni el directorio, ni
 * las reglas de invitacion. Mismo reparto que `verifyIdToken.ts` / la ruta que
 * lo llama.
 *
 * ## Por que `jose` y no `firebase-admin`
 *
 * Exactamente el mismo argumento que ya documenta `verifyIdToken.ts`, y por eso
 * se repite aqui: `firebase-admin` arrastra gRPC, su propio cliente HTTP y una
 * superficie de credenciales que este proceso no quiere. Lo que hace falta de
 * verdad son dos peticiones HTTP y una firma RS256, y `jose` -- que ya es
 * dependencia por la verificacion de tokens -- firma RS256 sin traerse nada
 * mas. Una dependencia que se instala para dos llamadas es una dependencia que
 * hay que auditar, actualizar y explicar para siempre.
 *
 * ## Los tres endpoints, y de donde sale cada uno
 *
 * Todos CONFIRMADOS contra la documentacion oficial, no deducidos:
 *
 * 1. Token de acceso:
 *    `POST https://oauth2.googleapis.com/token`, cuerpo
 *    `application/x-www-form-urlencoded` con
 *    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` y `assertion=<JWT
 *    RS256>`. Claims `iss` (el client_email), `scope`, `aud` (siempre la propia
 *    url del token), `iat` y `exp` (maximo una hora sobre `iat`).
 *    developers.google.com/identity/protocols/oauth2/service-account
 *
 * 2. Alta de cuenta:
 *    `POST https://identitytoolkit.googleapis.com/v1/projects/{projectId}/accounts`
 *    con `{ email, password }` y `Authorization: Bearer`. Devuelve `localId`,
 *    que es el uid. En una peticion de ADMINISTRACION `localId` no se manda: lo
 *    asigna Google. El error de correo repetido es `EMAIL_EXISTS`.
 *    cloud.google.com/identity-platform/docs/reference/rest/v1/projects/accounts
 *
 * 3. Desactivar cuenta:
 *    `POST https://identitytoolkit.googleapis.com/v1/projects/{projectId}/accounts:update`
 *    con `{ localId, disableUser: true }`.
 *    .../rest/v1/projects.accounts/update
 *
 * Los dos de identitytoolkit aceptan el scope `identitytoolkit` o el mas amplio
 * `cloud-platform`; se pide el estrecho, que es el unico que esta cuenta de
 * servicio necesita.
 *
 * ## Por que el projectId sale de la credencial y no de `FIREBASE_PROJECT_ID`
 *
 * Porque son dos variables distintas que TIENEN que apuntar al mismo proyecto,
 * y si se leen de sitios distintos nada impide que se descuadren: el servidor
 * crearia cuentas en un proyecto y verificaria tokens contra otro, y el sintoma
 * seria "doy de alta a alguien y no puede entrar", sin un solo error. La clave
 * de servicio ya trae su `project_id` y es, por construccion, el proyecto donde
 * esa clave puede hacer algo.
 */

import { importPKCS8, SignJWT } from 'jose';
import { IdentityAdminError, type IdentityAdmin } from './identityAdminPort.ts';

/** Solo los campos que se usan. La clave de GCP trae bastantes mas. */
export interface ServiceAccountKey {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1/projects';
const SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';

/** Vida de la asercion. El maximo que acepta Google es una hora. */
const ASSERTION_TTL_SECONDS = 3600;

/**
 * Margen con el que se considera caducado el token de acceso antes de tiempo.
 * Sin el, un token que caduca dentro de dos segundos se usaria igual y la
 * peticion llegaria a Google ya vencida: un 401 esporadico e irreproducible,
 * que es la peor clase de fallo que se puede dejar puesto.
 */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Lee la clave de cuenta de servicio del entorno. Devuelve `null` ante
 * cualquier problema en vez de lanzar: es la convencion de degradacion que ya
 * siguen `resolveAuthConfig` y `resolveDirectoryConfig`. Un `.env` a medio
 * escribir no puede tumbar el servidor entero -- lo unico que depende de esta
 * credencial es el alta de invitaciones, que responde 503 y deja el resto del
 * panel en pie.
 *
 * El valor llega como JSON de UNA sola linea: `office-deploy.sh` lo compacta al
 * escribir el `.env`, porque un valor multilinea partiria el fichero y el
 * compose leeria solo la primera linea. Sigue siendo el mismo JSON: los saltos
 * de la clave privada viajan escapados como `\n`, que es como el JSON los
 * representa de todas formas, y `JSON.parse` los devuelve como saltos reales,
 * que es lo que `importPKCS8` necesita.
 */
export function parseServiceAccountKey(raw: string | undefined): ServiceAccountKey | null {
  if (!raw || raw.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { project_id, client_email, private_key, token_uri } = parsed as Record<string, unknown>;
  if (!isNonEmptyText(project_id)) return null;
  if (!isNonEmptyText(client_email)) return null;
  if (!isNonEmptyText(private_key)) return null;

  return {
    project_id,
    client_email,
    private_key,
    token_uri: isNonEmptyText(token_uri) ? token_uri : DEFAULT_TOKEN_URI,
  };
}

export interface GcpIdentityAdminOptions {
  credentials: ServiceAccountKey;
  /** Inyectable para probar el contrato entero sin red, como en `adminClient.ts`. */
  fetchImpl?: typeof fetch;
  /** Reloj inyectable: sin el, la caducidad del token dependeria de la hora. */
  now?: () => number;
}

/**
 * Traduce el cuerpo de error de Identity Toolkit al codigo del puerto. Google
 * responde `{ error: { code, message, status } }` y el `message` es el codigo
 * simbolico, a veces con detalles pegados detras (`WEAK_PASSWORD : Password
 * should be...`). Solo se reconoce `EMAIL_EXISTS`; todo lo demas es
 * `unavailable` a proposito, porque inventarle un significado a un error que no
 * se conoce es como acaba un 500 disfrazado de 409.
 */
function codeForIdentityError(body: unknown): 'email-exists' | 'unavailable' {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' && message.startsWith('EMAIL_EXISTS')
    ? 'email-exists'
    : 'unavailable';
}

export function createGcpIdentityAdmin({
  credentials,
  fetchImpl = fetch,
  now = Date.now,
}: GcpIdentityAdminOptions): IdentityAdmin {
  /**
   * `importPKCS8` es asincrono y el resultado es reutilizable, asi que se
   * importa una sola vez y se guarda la promesa. Importarla por peticion
   * pagaria un parseo de clave RSA cada vez, y sobre todo dejaria copias del
   * material de clave repartidas por el heap sin motivo.
   */
  let signingKey: Promise<CryptoKey> | null = null;
  function key(): Promise<CryptoKey> {
    signingKey ??= importPKCS8(credentials.private_key, 'RS256') as Promise<CryptoKey>;
    return signingKey;
  }

  /**
   * El token de acceso vale una hora; pedirlo por operacion serian dos viajes a
   * googleapis.com por cada alta y por cada revocacion. Se cachea CON su
   * caducidad, nunca indefinidamente.
   */
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > now()) return cached.token;

    const issuedAt = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(credentials.client_email)
      .setAudience(credentials.token_uri)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ASSERTION_TTL_SECONDS)
      .sign(await key());

    const response = await fetchImpl(credentials.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!response.ok || !isNonEmptyText(body?.access_token)) {
      // NO se cachea nada en el camino de fallo: un token vacio guardado aqui
      // haria que todos los intentos siguientes fallasen igual hasta reiniciar.
      throw new IdentityAdminError('unavailable');
    }

    const ttl = typeof body.expires_in === 'number' ? body.expires_in : ASSERTION_TTL_SECONDS;
    cached = { token: body.access_token, expiresAt: now() + ttl * 1000 };
    return cached.token;
  }

  /**
   * Un solo sitio donde se llama a Identity Toolkit, y un solo sitio donde
   * cualquier fallo -- HTTP, de red, un cuerpo que no es JSON -- se convierte en
   * `IdentityAdminError`. Que no escape ninguna otra excepcion es parte del
   * contrato: `adminRoutes.ts` solo sabe compensar la cuenta huerfana si el
   * error que recibe es uno de los dos que el puerto promete.
   */
  async function call(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const token = await accessToken();

    let response: Response;
    try {
      response = await fetchImpl(`${IDENTITY_TOOLKIT}/${credentials.project_id}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      // `fetch` lanza `TypeError` cuando la red no responde. Dejarlo escapar
      // acabaria en el 500 generico de Express y la ruta no podria distinguir
      // "no se creo la cuenta" de "no se sabe si se creo".
      throw new IdentityAdminError('unavailable');
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) throw new IdentityAdminError(codeForIdentityError(payload));
    // Un 200 que no es JSON no es un exito: es un proxy o un portal cautivo
    // respondiendo por Google, y tragarlo daria por buena un alta que no existe.
    if (payload === null) throw new IdentityAdminError('unavailable');

    return payload;
  }

  return {
    async createAccount(email, password) {
      // `localId` NO se manda: en una peticion de administracion Google lo
      // asigna, y mandarlo obligaria a inventar uids nosotros.
      //
      // La contrasena entra en el cuerpo de ESTA peticion y no sale de aqui: no
      // se registra, no se mete en el mensaje de ningun error (por eso
      // `IdentityAdminError` no lleva detalles) y no se guarda en ninguna parte.
      const payload = await call('accounts', { email, password });

      const uid = payload.localId;
      if (!isNonEmptyText(uid)) {
        // Un 200 sin `localId` no se puede tratar como exito: la ruta guardaria
        // una invitacion con un uid vacio, y esa fila no casaria nunca con el
        // token de nadie ni se podria desactivar al revocarla.
        throw new IdentityAdminError('unavailable');
      }
      return uid;
    },

    async disableAccount(uid) {
      await call('accounts:update', { localId: uid, disableUser: true });
    },
  };
}

/**
 * Cableado desde el entorno, hermano de `directoryFromEnv` y de
 * `authVerifierFromEnv`. `null` -- y no `undefined` -- porque el override de
 * `createOfficeServer` distingue "no configurado" de "no pasado", igual que con
 * el directorio.
 */
export function identityAdminFromEnv(
  env: { IDENTITY_ADMIN_CREDENTIALS?: string },
  fetchImpl?: typeof fetch,
): IdentityAdmin | null {
  const credentials = parseServiceAccountKey(env.IDENTITY_ADMIN_CREDENTIALS);
  if (credentials === null) return null;
  return createGcpIdentityAdmin({ credentials, fetchImpl });
}
