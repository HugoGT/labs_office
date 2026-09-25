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
 * ## Los endpoints, y de donde sale cada uno
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
 * 4. Password-reset email (#94):
 *    `POST https://identitytoolkit.googleapis.com/v1/projects/{projectId}/accounts:sendOobCode`
 *    with `{ requestType: "PASSWORD_RESET", email }`. The project-scoped form
 *    needs an OAuth credential with `firebaseauth.users.sendEmail`, which
 *    `roles/identitytoolkit.admin` includes. Google sends the email unless
 *    `returnOobLink` is true, and that field is never sent.
 *    .../rest/v1/projects.accounts/sendOobCode
 *
 * Los de identitytoolkit aceptan el scope `identitytoolkit` o el mas amplio
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
 *
 * ## Por que hay DOS formas de conseguir el token
 *
 * Porque la clave de cuenta de servicio no siempre se puede crear: la politica
 * de organizacion `constraints/iam.disableServiceAccountKeyCreation` la
 * prohibe, y entonces no hay JSON que poner en `IDENTITY_ADMIN_CREDENTIALS`.
 * El servidor corre dentro de una VM de GCE que ya tiene identidad propia con
 * scope `cloud-platform`, asi que puede pedirle el token al servidor de
 * metadata y no guardar ninguna credencial en ninguna parte. Es el mismo
 * razonamiento que este repositorio ya defiende en
 * `.github/workflows/deploy-test.yml`, donde la federacion OIDC sustituyo a la
 * clave descargada por las mismas razones.
 *
 * `CredentialSource` es la costura entre las dos: lo unico que el adaptador
 * necesita saber es de que proyecto se trata y como conseguir un token fresco.
 * El cacheo del token se queda FUERA de la fuente, en el adaptador, para que no
 * haya dos politicas de caducidad que mantener sincronizadas.
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
 * Cuanto se supone que dura un token cuando la respuesta no lo dice. Una hora
 * es lo que Google concede siempre; suponer mas seria inventarse una caducidad
 * que nadie ha prometido, y el margen de abajo cubre el resto.
 */
const TOKEN_TTL_FALLBACK_SECONDS = 3600;

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

/** Un token recien pedido, con lo que dice durar. */
export interface TokenGrant {
  token: string;
  expiresInSeconds: number;
}

/**
 * De donde salen el proyecto y el token. Dos implementaciones: la clave de
 * cuenta de servicio y el servidor de metadata de la VM (ver la cabecera).
 */
export interface CredentialSource {
  /** Proyecto donde esta credencial puede administrar cuentas. */
  projectId(): Promise<string>;
  /** Pide un token NUEVO; el cacheo con su caducidad es del llamante. */
  requestToken(): Promise<TokenGrant>;
}

/**
 * La credencial clasica: un JWT RS256 firmado con la clave privada de la cuenta
 * de servicio, canjeado por un token de acceso en el flujo JWT-bearer.
 */
export function serviceAccountSource(
  credentials: ServiceAccountKey,
  fetchImpl: typeof fetch = fetch,
): CredentialSource {
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

  return {
    // Sale de la propia clave y no del entorno, por lo que explica la cabecera:
    // es, por construccion, el proyecto donde esa clave puede hacer algo.
    projectId: () => Promise.resolve(credentials.project_id),

    async requestToken() {
      const issuedAt = Math.floor(Date.now() / 1000);
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
        throw new IdentityAdminError('unavailable');
      }

      return {
        token: body.access_token,
        expiresInSeconds:
          typeof body.expires_in === 'number' ? body.expires_in : TOKEN_TTL_FALLBACK_SECONDS,
      };
    },
  };
}

/**
 * Base del servidor de metadata. Se usa la IP de enlace local y NO el nombre
 * `metadata.google.internal` a proposito: ese nombre lo resuelve el
 * `/etc/hosts` que Google escribe en la VM, y los contenedores no lo heredan,
 * asi que dentro del contenedor no resuelve. La IP si es alcanzable desde la
 * red del contenedor, y es la misma en todas las instancias de GCE.
 */
const METADATA_BASE = 'http://169.254.169.254/computeMetadata/v1';

/**
 * Obligatoria en las dos peticiones: sin ella el servidor de metadata responde
 * 403. Es su defensa contra el SSRF, porque una peticion reflejada desde fuera
 * (un navegador, un proxy despistado) no anade cabeceras a medida.
 */
const METADATA_HEADERS = { 'Metadata-Flavor': 'Google' };

/**
 * La credencial sin clave: el token lo emite el servidor de metadata para la
 * cuenta de servicio de la propia VM. No hay nada que descargar, nada que
 * guardar y nada que rotar, y por eso es el unico camino viable cuando la
 * organizacion prohibe crear claves de cuenta de servicio.
 *
 * El scope no se puede estrechar aqui como en el flujo de la clave: lo fija la
 * VM (`cloud-platform`), que incluye `identitytoolkit`. Quien acota de verdad
 * lo que esta identidad puede hacer son sus roles IAM.
 */
export function metadataServerSource(fetchImpl: typeof fetch = fetch): CredentialSource {
  // El project id no cambia en toda la vida de la VM, asi que se pide una vez.
  // Se cachea el VALOR y solo tras una lectura buena: guardar aqui un fallo
  // dejaria la funcion rota hasta reiniciar el contenedor.
  let cachedProjectId: string | null = null;

  async function get(path: string): Promise<Response> {
    try {
      return await fetchImpl(`${METADATA_BASE}${path}`, { headers: METADATA_HEADERS });
    } catch {
      // `fetch` lanza `TypeError` cuando no hay ruta hasta la IP de enlace
      // local: fuera de GCE, o con la red del contenedor mal montada. El
      // llamante solo sabe tratar `IdentityAdminError`.
      throw new IdentityAdminError('unavailable');
    }
  }

  return {
    async projectId() {
      if (cachedProjectId !== null) return cachedProjectId;

      const response = await get('/project/project-id');
      // Texto plano, no JSON: este endpoint devuelve el id pelado.
      const text = response.ok ? await response.text().catch(() => '') : '';
      if (text.trim().length === 0) throw new IdentityAdminError('unavailable');

      cachedProjectId = text.trim();
      return cachedProjectId;
    },

    async requestToken() {
      const response = await get('/instance/service-accounts/default/token');

      const body = (await response.json().catch(() => null)) as {
        access_token?: unknown;
        expires_in?: unknown;
      } | null;
      if (!response.ok || !isNonEmptyText(body?.access_token)) {
        throw new IdentityAdminError('unavailable');
      }

      return {
        token: body.access_token,
        expiresInSeconds:
          typeof body.expires_in === 'number' ? body.expires_in : TOKEN_TTL_FALLBACK_SECONDS,
      };
    },
  };
}

export interface GcpIdentityAdminOptions {
  /** De donde salen el proyecto y el token: la clave o el servidor de metadata. */
  source: CredentialSource;
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
  source,
  fetchImpl = fetch,
  now = Date.now,
}: GcpIdentityAdminOptions): IdentityAdmin {
  /**
   * El token de acceso vale una hora; pedirlo por operacion serian dos viajes a
   * googleapis.com por cada alta y por cada revocacion. Se cachea CON su
   * caducidad, nunca indefinidamente.
   */
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > now()) return cached.token;

    // Si la fuente falla lanza `IdentityAdminError` y aqui no se asigna nada:
    // NO se cachea el camino de fallo, porque un token vacio guardado haria que
    // todos los intentos siguientes fallasen igual hasta reiniciar.
    const grant = await source.requestToken();

    cached = { token: grant.token, expiresAt: now() + grant.expiresInSeconds * 1000 };
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
    const projectId = await source.projectId();

    let response: Response;
    try {
      response = await fetchImpl(`${IDENTITY_TOOLKIT}/${projectId}/${path}`, {
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

    async sendPasswordReset(email) {
      // No `returnOobLink`: with it Google returns the reset link to the caller
      // INSTEAD of emailing it, which would hand the admin a way to set the
      // password again. Every failure (EMAIL_NOT_FOUND, USER_DISABLED, the
      // RESET_PASSWORD_EXCEED_LIMIT rate limit, IAM) collapses into
      // `unavailable` through `call`: the route handles them all the same way.
      await call('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });
    },
  };
}

/**
 * `true` o `1`, sin distinguir mayusculas y recortando espacios. El valor lo
 * escribe un script de shell dentro de un `.env`, donde un espacio de mas es un
 * descuido corriente y no una forma de decir que no.
 */
function isEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

/**
 * Cableado desde el entorno, hermano de `directoryFromEnv` y de
 * `authVerifierFromEnv`. `null` -- y no `undefined` -- porque el override de
 * `createOfficeServer` distingue "no configurado" de "no pasado", igual que con
 * el directorio.
 *
 * La clave manda sobre la metadata, y la precedencia es explicita a proposito:
 * una clave puesta en el entorno nombra una identidad concreta que alguien
 * eligio, mientras que la metadata es la identidad que la VM tiene de todas
 * formas. Si estan las dos, gana la decision deliberada.
 */
export function identityAdminFromEnv(
  env: { IDENTITY_ADMIN_CREDENTIALS?: string; IDENTITY_ADMIN_USE_METADATA?: string },
  fetchImpl?: typeof fetch,
): IdentityAdmin | null {
  const credentials = parseServiceAccountKey(env.IDENTITY_ADMIN_CREDENTIALS);
  if (credentials !== null) {
    return createGcpIdentityAdmin({
      source: serviceAccountSource(credentials, fetchImpl),
      fetchImpl,
    });
  }

  if (isEnabled(env.IDENTITY_ADMIN_USE_METADATA)) {
    return createGcpIdentityAdmin({ source: metadataServerSource(fetchImpl), fetchImpl });
  }

  // Sin ninguna de las dos se degrada igual que hasta ahora: invitar responde
  // 503 y el resto del panel sigue en pie.
  return null;
}
