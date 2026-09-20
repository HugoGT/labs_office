import { useState, type DragEvent } from 'react';
import { DESK_SLOT_COLUMNS, DESK_SLOT_COUNT } from '../game/deskLayout';
import {
  DESK_ROTATIONS,
  type DeskDecorAsset,
  type DeskItemPlacement,
  type DeskRotation,
  type PlacedDeskItem,
  type SaveDeskOutcome,
} from '../game/deskDecorPort';
import styles from './DeskDecorEditor.module.css';

/**
 * Editor de la decoracion del escritorio propio (#7, slice 6). Presentacional
 * (D3): no conoce el puerto ni la red, recibe lo que hay y avisa hacia arriba.
 *
 * ## El borrador es el escritorio ENTERO
 *
 * `POST /me/desk` borra e inserta, asi que `onSave` recibe las nueve cajas tal
 * como quedaron y no un delta. Mandar solo lo tocado dejaria que el servidor
 * "completase" lo que falta, que es precisamente lo que no hace.
 *
 * ## Una pieza retirada se conserva, y por eso son DOS listas (D1b)
 *
 * El selector se llena de `/assets`, que filtra lo retirado, y el escritorio
 * de `/me/desk`, que no. Aqui NO se cruzan: una pieza que ya esta puesta se
 * pinta con lo que trae ella misma -- nombre y giro -- aunque el catalogo ya
 * no la ofrezca. Cruzarlas la borraria de la pantalla de su dueno, y el
 * primer guardado se la quitaria de verdad sin que hubiese pedido nada. Se
 * conserva, se puede quitar, y no se puede volver a anadir porque el selector
 * no la trae.
 *
 * ## Arrastrar se suma al clic, no lo sustituye
 *
 * Elegir caja y luego pieza sigue siendo el camino que funciona con teclado y
 * lector de pantalla; el arrastre solo anade un atajo con raton encima. Por eso
 * el boton del selector conserva su `disabled` y el arrastrable es el `<li>`.
 *
 * ## Sin escritorio no hay editor
 *
 * La decoracion cuelga de la persona, pero se ve en el sitio donde esa persona
 * se sienta. Sin sitio, un editor seria una pantalla que guarda algo que nadie
 * puede ver: se ofrece coger uno.
 */

/** Una caja del borrador. `assetId` es lo unico que el servidor lee; el resto es para pintarla. */
interface DraftItem {
  assetId: string;
  rotation: DeskRotation;
  name: string;
}

/**
 * Lo que va en el puno mientras se arrastra. Vive en estado de React y NO en
 * `dataTransfer`: jsdom implementa `DataTransfer` a medias, y un handler que
 * leyese `getData` dejaria esta interaccion sin poder probarse en la capa unit.
 */
type DragLoad =
  | { from: 'catalog'; assetId: string; name: string }
  | { from: 'slot'; slot: number };

export interface DeskDecorEditorProps {
  /** Como se llama el escritorio propio, o `null` si no se ocupa ninguno. */
  deskLabel: string | null;
  /** Lo que se puede colocar hoy. Llega ya filtrado: ver la cabecera. */
  catalog: readonly DeskDecorAsset[];
  /** Lo que ya esta puesto, tal como lo sirve `/me/desk`. */
  items: readonly PlacedDeskItem[];
  /** Recibe el escritorio ENTERO. Devuelve lo que contesto el servidor. */
  onSave: (items: readonly DeskItemPlacement[]) => Promise<SaveDeskOutcome>;
  onClose: () => void;
}

/** El giro siguiente, dando la vuelta. Solo las cuatro que el servidor acepta. */
function nextRotation(rotation: DeskRotation): DeskRotation {
  const index = DESK_ROTATIONS.indexOf(rotation);
  return DESK_ROTATIONS[(index + 1) % DESK_ROTATIONS.length];
}

/** Lo puesto, indexado por caja. Una caja, una pieza: el servidor rechaza dos con un 400. */
function toDraft(items: readonly PlacedDeskItem[]): Map<number, DraftItem> {
  return new Map(
    items.map((item) => [
      item.slot,
      { assetId: item.assetId, rotation: item.rotation, name: item.name },
    ]),
  );
}

export function DeskDecorEditor({
  deskLabel,
  catalog,
  items,
  onSave,
  onClose,
}: DeskDecorEditorProps) {
  /**
   * El borrador se siembra UNA vez con lo que habia. No se resincroniza con
   * `items` en cada render a proposito: quien esta colocando piezas perderia
   * lo que lleva hecho en cuanto llegase una relectura.
   */
  const [draft, setDraft] = useState<Map<number, DraftItem>>(() => toDraft(items));
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragLoad, setDragLoad] = useState<DragLoad | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);

  if (deskLabel === null) {
    return (
      <section className={styles.panel} aria-label="Decorar mi escritorio">
        <div className={styles.head}>
          <h2 className={styles.title}>Decorar mi escritorio</h2>
          <button className={styles.close} type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <p className={styles.empty}>
          Todavía no te sientas en ningún sitio: elige un escritorio libre en la oficina y vuelve
          para decorarlo.
        </p>
      </section>
    );
  }

  function place(asset: DeskDecorAsset): void {
    if (selected === null) return;
    setSaved(false);
    // Sustituye lo que hubiese en esa caja: apilar dos piezas en el mismo slot
    // es el 400 de `assertValidDeskShape`.
    setDraft((current) =>
      new Map(current).set(selected, { assetId: asset.id, rotation: 0, name: asset.name }),
    );
  }

  function startDrag(event: DragEvent<HTMLElement>, load: DragLoad): void {
    // Firefox no arranca un arrastre si nadie asigna datos, aunque luego no los
    // lea nadie: el `setData` esta por eso y no porque haga falta aqui -- la
    // carga viaja en `dragLoad`. El `?.` porque el evento puede llegar sin
    // `dataTransfer` (jsdom no lo pone siempre).
    event.dataTransfer?.setData(
      'text/plain',
      load.from === 'catalog' ? load.assetId : String(load.slot),
    );
    setDragLoad(load);
  }

  function startSlotDrag(event: DragEvent<HTMLElement>, slot: number): void {
    // Una caja vacia no lleva nada: sin este corte, soltarla sobre otra borraria
    // la pieza del destino con un movimiento que no transportaba ninguna.
    if (!draft.has(slot)) return;
    startDrag(event, { from: 'slot', slot });
  }

  function allowDrop(event: DragEvent<HTMLElement>, slot: number): void {
    if (dragLoad === null) return;
    // Sin `preventDefault` el navegador toma la caja por destino invalido y el
    // `drop` no se dispara NUNCA. Es el fallo clasico de esta API.
    event.preventDefault();
    setDragOverSlot(slot);
  }

  function leaveSlot(slot: number): void {
    // Solo se apaga la caja que se esta dejando: al pasar de una a otra el
    // `dragLeave` de la vieja llega despues del `dragOver` de la nueva, y
    // apagarlo a ciegas dejaria el rastro siempre apagado.
    setDragOverSlot((current) => (current === slot ? null : current));
  }

  function drop(event: DragEvent<HTMLElement>, slot: number): void {
    // Firefox intentaria navegar al texto soltado si nadie lo impide.
    event.preventDefault();
    const load = dragLoad;
    endDrag();
    if (load === null) return;

    const next = new Map(draft);
    if (load.from === 'catalog') {
      // Misma semantica que `place`: sustituye, porque una caja es una pieza.
      next.set(slot, { assetId: load.assetId, rotation: 0, name: load.name });
    } else {
      // Soltar una pieza donde ya estaba no es un movimiento.
      if (load.slot === slot) return;
      const moved = draft.get(load.slot);
      if (moved === undefined) return;
      const displaced = draft.get(slot);
      next.set(slot, moved);
      // INTERCAMBIO, y no la sustitucion que hace `place`: en un movimiento
      // interno, sustituir destruiria en silencio una pieza que su dueno ya
      // habia colocado, y el gesto nunca dijo "tira esa". El intercambio no
      // pierde nada y se deshace repitiendo el arrastre al reves. Si el destino
      // estaba vacio es el caso simple: el origen se queda sin nada.
      if (displaced === undefined) next.delete(load.slot);
      else next.set(load.slot, displaced);
    }

    setDraft(next);
    setSaved(false);
    // El destino queda elegido para que "Girar" y "Quitar" actuen sobre lo que
    // se acaba de mover, que es lo que mira quien lo movio. Soltar NO guarda:
    // `POST /me/desk` borra e inserta, y dispararlo con cada gesto escribiria el
    // escritorio a medio componer.
    setSelected(slot);
  }

  function endDrag(): void {
    setDragLoad(null);
    setDragOverSlot(null);
  }

  function rotate(): void {
    if (selected === null) return;
    const item = draft.get(selected);
    if (item === undefined) return;
    setSaved(false);
    setDraft((current) =>
      new Map(current).set(selected, { ...item, rotation: nextRotation(item.rotation) }),
    );
  }

  function remove(): void {
    if (selected === null) return;
    setSaved(false);
    setDraft((current) => {
      const next = new Map(current);
      next.delete(selected);
      return next;
    });
  }

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      // El escritorio entero y en orden de caja: el orden no significa nada
      // para el servidor, pero uno estable se lee mejor en cualquier traza.
      const placements: DeskItemPlacement[] = [...draft.entries()]
        .sort(([a], [b]) => a - b)
        .map(([slot, item]) => ({ assetId: item.assetId, slot, rotation: item.rotation }));

      const outcome = await onSave(placements);
      if (outcome === 'saved') {
        setSaved(true);
        return;
      }
      // Los dos finales que no son un exito se cuentan por separado: uno se
      // arregla cambiando algo y el otro volviendo a intentarlo.
      setError(
        outcome === 'rejected'
          ? 'El servidor no aceptó esta decoración. Puede que alguna pieza se haya retirado del catálogo: quítala y vuelve a guardar.'
          : 'No se pudo guardar la decoración. Inténtalo de nuevo en un momento.',
      );
    } finally {
      setPending(false);
    }
  }

  const current = selected === null ? undefined : draft.get(selected);

  return (
    <section className={styles.panel} role="dialog" aria-label={`Decorar ${deskLabel}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>Decorar {deskLabel}</h2>
        <button className={styles.close} type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>

      <p className={styles.hint}>
        Arrastra una pieza hasta una caja, o elige la caja y luego la pieza. Arrastra una caja sobre
        otra para mover o intercambiar.
      </p>

      {/* Las columnas salen de `deskLayout` y no de una copia en el CSS: el
          reparto por filas es un CONTRATO con la escena, que coloca cada pieza
          con `deskSlotRect`. Dos copias del 3 dejarian esta rejilla
          transpuesta el dia que cambie el lado del area. */}
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `repeat(${DESK_SLOT_COLUMNS}, 1fr)` }}
      >
        {Array.from({ length: DESK_SLOT_COUNT }, (_unused, slot) => {
          const item = draft.get(slot);
          const className = [
            styles.slot,
            item === undefined ? styles.slotEmpty : '',
            dragOverSlot === slot ? styles.slotOver : '',
            dragLoad?.from === 'slot' && dragLoad.slot === slot ? styles.slotSource : '',
          ]
            .filter((name) => name !== '')
            .join(' ');
          return (
            <button
              key={slot}
              type="button"
              // La etiqueta lleva el numero de caja Y lo que hay dentro: sin lo
              // segundo, quien navega con lector de pantalla no sabria cual
              // esta ocupada.
              aria-label={`Caja ${slot + 1}: ${item?.name ?? 'vacía'}`}
              aria-pressed={selected === slot}
              className={className}
              // Solo una caja con pieza se arrastra; toda caja recibe.
              draggable={item !== undefined}
              onClick={() => setSelected(slot)}
              onDragStart={(event) => startSlotDrag(event, slot)}
              onDragOver={(event) => allowDrop(event, slot)}
              onDragLeave={() => leaveSlot(slot)}
              onDrop={(event) => drop(event, slot)}
              onDragEnd={endDrag}
            >
              {item?.name ?? '+'}
            </button>
          );
        })}
      </div>

      <div className={styles.actions}>
        <button
          className={styles.action}
          type="button"
          disabled={current === undefined}
          onClick={rotate}
        >
          🔄 Girar
        </button>
        <button
          className={styles.action}
          type="button"
          disabled={current === undefined}
          onClick={remove}
        >
          🗑 Quitar
        </button>
      </div>

      {catalog.length === 0 ? (
        <p className={styles.empty}>Todavía no hay piezas en el catálogo de la oficina.</p>
      ) : (
        <ul className={styles.pieces} aria-label="Piezas que puedes colocar">
          {catalog.map((asset) => (
            /* El arrastrable es el `<li>` y no el boton: un control
               deshabilitado no dispara eventos de arrastre, y el boton lo esta
               mientras no haya caja elegida. Arrastrar si nombra el destino por
               si mismo, asi que no espera a que se elija una. */
            <li
              key={asset.id}
              className={styles.pieceItem}
              draggable
              onDragStart={(event) =>
                startDrag(event, { from: 'catalog', assetId: asset.id, name: asset.name })
              }
              onDragEnd={endDrag}
            >
              {/* Deshabilitado mientras no haya caja elegida: colocar con un
                  clic en "la primera libre" adivinaria donde la quiere quien
                  mira, y el escritorio tiene nueve cajas justo para que lo
                  diga. El arrastre no adivina nada, por eso no se deshabilita. */}
              <button
                className={styles.piece}
                type="button"
                disabled={selected === null}
                onClick={() => place(asset)}
              >
                {asset.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className={styles.save} type="button" disabled={pending} onClick={() => void save()}>
        {pending ? 'Guardando…' : 'Guardar'}
      </button>

      {/* `role="status"` y `role="alert"`, como en el panel del catalogo: el
          resultado aparece lejos del foco y sin anunciarlo no existe para un
          lector de pantalla. */}
      {saved && (
        <p className={styles.saved} role="status">
          ✅ Decoración guardada
        </p>
      )}
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
