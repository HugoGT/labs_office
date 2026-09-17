import { describe, expect, it } from 'vitest';
import { NPCS } from './npcData';
import { PRESENCE_STATUSES } from './officeProtocol';

describe('npcData', () => {
  it('porta las 33 entradas del prototipo en orden, con nombres verbatim (app.js:38-51)', () => {
    expect(NPCS).toHaveLength(33);
    expect(NPCS[0]).toEqual({ name: 'Franklin Ga', tx: 4, ty: 7, status: 'g' });
    expect(NPCS[9]).toEqual({ name: 'Angélica', tx: 26, ty: 17, status: 'g' });
    expect(NPCS[6]).toEqual({ name: 'paulotijero', tx: 6, ty: 16, status: 'y' });
    expect(NPCS[18]).toEqual({ name: 'Jordan Távara', tx: 20, ty: 28, status: 'g' });
    expect(NPCS[27]).toEqual({ name: 'kevin', tx: 17, ty: 38, status: 'g' });
    expect(NPCS[28]).toEqual({ name: 'ivan herbas', tx: 18, ty: 39, status: 'g' });
    expect(NPCS[32]).toEqual({ name: 'Luis', tx: 33, ty: 38, status: 'r' });
  });

  it('ninguna entrada declara wander: el deambular aleatorio se retiro del roster', () => {
    // Los NPCs simulados se quedan para que la oficina no se vea vacia, pero su
    // unico comportamiento es acudir cuando los llaman (ver walkNpcTo). Un
    // `wander` residual aqui seria dato muerto que invita a resucitar el bucle.
    for (const npc of NPCS) {
      expect(npc).not.toHaveProperty('wander');
    }
  });

  it('cada entrada trae un estado del vocabulario compartido, no una letra cualquiera', () => {
    // El color y la etiqueta ya no viven aqui (ver `presence.test.ts`): el
    // roster solo aporta que estado arranca cada NPC.
    for (const npc of NPCS) {
      expect(PRESENCE_STATUSES).toContain(npc.status);
    }
  });
});
