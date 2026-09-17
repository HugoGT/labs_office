/**
 * Configuracion del directorio de usuarios (#24). Dos variables de entorno:
 * donde vive la base de datos y quien es el primer superadmin.
 *
 * Degrada igual que `authConfig.ts`: sin `DATABASE_URL` esto devuelve `null`,
 * que significa "directorio desactivado" y preserva exactamente el
 * comportamiento anterior a este cambio (nadie tiene rol, nadie caduca, nadie
 * queda fuera por no estar en una tabla). Es lo que permite seguir levantando
 * el servidor en local sin un Postgres delante, y lo que hace que la suite de
 * `OfficeRoom` siga corriendo sin base de datos.
 *
 * Eso NO es un default aceptable en un despliegue: un entorno desplegado DEBE
 * definir `DATABASE_URL`. Sin el, las invitaciones con caducidad no existen --
 * toda cuenta valida de Identity Platform entra a la oficina para siempre, que
 * es justo el agujero que este cambio cierra. `/health` expone el modo efectivo
 * (`directory: 'enabled' | 'disabled'`) para poder comprobarlo desde fuera sin
 * adivinar, igual que ya hace con `auth`.
 *
 * `BOOTSTRAP_SUPERADMIN_EMAIL` es opcional y su ausencia solo significa "nadie
 * se promociona". No es un interruptor del directorio: sin el, el resto sigue
 * funcionando y simplemente no hay superadmin hasta que alguien defina la
 * variable. Ver `pgDirectory.ts` para por que la promocion se ata a un email
 * concreto y no a "el primero que entre".
 */

export interface DirectoryConfig {
  databaseUrl: string;
  bootstrapSuperadminEmail: string | null;
}

export function resolveDirectoryConfig(env: {
  DATABASE_URL?: string;
  BOOTSTRAP_SUPERADMIN_EMAIL?: string;
}): DirectoryConfig | null {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) return null;

  // Vacio cuenta como ausente: una variable definida pero en blanco no es una
  // intencion, es un `.env` a medio escribir, y dejarla pasar solo cambiaria
  // "no promociona porque no esta puesta" por "no promociona y no se sabe por que".
  const bootstrapSuperadminEmail = env.BOOTSTRAP_SUPERADMIN_EMAIL?.trim();

  return {
    databaseUrl,
    bootstrapSuperadminEmail: bootstrapSuperadminEmail ? bootstrapSuperadminEmail : null,
  };
}
