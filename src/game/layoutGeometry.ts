/**
 * Geometria pura de rectangulos, compartida entre cliente y servidor (#74,
 * PR3a). `boundsOverlap` vivia solo en `server/src/spaces/spaceRules.ts`,
 * que importa `node:crypto` para `hashSpaces` y por eso el cliente no puede
 * importarlo entero. El editor de layout en oficina (PR3b) necesita el MISMO
 * pre-chequeo de solape del lado del cliente -- antes de siquiera pedirle al
 * servidor que confirme una colocacion, para dar feedback instantaneo con el
 * ghost de arrastre -- asi que esta funcion se muda AQUI y `spaceRules.ts`
 * la REEXPORTA en vez de duplicarla, para que las dos copias nunca puedan
 * divergir.
 *
 * `server/src/spaces/spaceRules.test.ts` sigue corriendo sin tocar: prueba
 * el re-export, no una copia.
 */

export interface SpaceBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pre-chequeo de solape en aplicacion (D1 de `spaceRules.ts` originalmente):
 * devuelve el mismo resultado que la restriccion de exclusion `spaces_no_overlap`
 * de Postgres, para poder ofrecer un 400/feedback amable en vez del 500 que
 * daria dejar que la base de datos lo atrapase primero.
 *
 * `<=` y no `<`: el spike de la tarea 2.1 (contra Postgres real, sin ninguna
 * extension) probo que `box && box` trata el contacto exacto de un borde
 * como solape -- dos rectangulos que solo se tocan en una linea, sin area en
 * comun, siguen chocando contra `spaces_no_overlap`. Un `<` estricto aqui
 * dejaria pasar algo que la base de datos rechaza, y el pre-chequeo dejaria
 * de cumplir su proposito.
 */
export function boundsOverlap(a: SpaceBounds, b: SpaceBounds): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}
