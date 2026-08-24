import { describe, expect, it } from 'vitest';
import { NPCS, STATUS_COLOR, STATUS_TXT } from './npcData';

describe('npcData', () => {
  it('porta las 33 entradas del prototipo en orden, con nombres verbatim (app.js:38-51)', () => {
    expect(NPCS).toHaveLength(33);
    expect(NPCS[0]).toEqual({ name: 'Franklin Ga', tx: 4, ty: 7, status: 'g', wander: false });
    expect(NPCS[9]).toEqual({ name: 'Angélica', tx: 26, ty: 17, status: 'g', wander: false });
    expect(NPCS[6]).toEqual({ name: 'paulotijero', tx: 6, ty: 16, status: 'y', wander: false });
    expect(NPCS[18]).toEqual({
      name: 'Jordan Távara',
      tx: 20,
      ty: 28,
      status: 'g',
      wander: true,
    });
    expect(NPCS[27]).toEqual({ name: 'kevin', tx: 17, ty: 38, status: 'g', wander: true });
    expect(NPCS[28]).toEqual({ name: 'ivan herbas', tx: 18, ty: 39, status: 'g', wander: false });
    expect(NPCS[32]).toEqual({ name: 'Luis', tx: 33, ty: 38, status: 'r', wander: false });
  });

  it('solo Pablo, Jordan Távara y kevin tienen wander:true', () => {
    const wanderers = NPCS.filter((npc) => npc.wander).map((npc) => npc.name);
    expect(wanderers).toEqual(['Pablo', 'Jordan Távara', 'kevin']);
  });

  it('mapea cada estado a su color y texto (app.js:53-54)', () => {
    expect(STATUS_COLOR).toEqual({ g: 0x22c55e, y: 0xeab308, r: 0xef4444 });
    expect(STATUS_TXT).toEqual({ g: 'Disponible', y: 'Ausente', r: 'En reunión' });
  });
});
