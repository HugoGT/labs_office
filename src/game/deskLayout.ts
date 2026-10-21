/**
 * Naming of what the scene draws for an assignable desk (#7, slice 5). Pure:
 * no Phaser, no network and no state. A desk is only a claimable 3x3 zone
 * since the office decor layer (#208); what stands on it is decor.
 */

/**
 * Nombre Phaser de la zona dibujada de un escritorio.
 *
 * Un nombre y no la geometria porque la geometria no identifica nada: dos
 * escritorios de 3x3 son dos rectangulos indistinguibles para cualquier filtro,
 * y la escena ya tiene rectangulos propios (los colisionadores fusionados). Es
 * el unico asidero estable para volver a encontrar lo dibujado.
 */
export function deskZoneName(deskId: string): string {
  return `desk:${deskId}`;
}
