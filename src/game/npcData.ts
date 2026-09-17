/**
 * Roster de NPCs, portado de `prototype/js/app.js:38-54`.
 * Decision registrada: los nombres reales se mantienen tal cual (ver
 * sdd/port-prototype-to-react-phaser/decision-npc-roster).
 *
 * El campo `wander` del prototipo se retiro: los NPCs simulados ya no
 * deambulan solos. Siguen presentes para que la oficina no se vea vacia, pero
 * su unico comportamiento es acudir cuando se les llama (`walkNpcTo`).
 *
 * El estado de cada NPC usa el mismo vocabulario que las personas reales
 * (`PresenceStatus`): un NPC "No molestar" y un companero "No molestar" se
 * pintan igual, aunque solo el segundo tenga audio que cortar.
 */

import type { PresenceStatus } from './officeProtocol';

export interface NpcSeed {
  name: string;
  tx: number;
  ty: number;
  status: PresenceStatus;
}

type RawNpc = readonly [string, number, number, PresenceStatus];

const RAW_NPCS: readonly RawNpc[] = [
  ['Franklin Ga', 4, 7, 'g'],
  ['Dennis ZR', 6, 7, 'g'],
  ['Ariana Colan', 14, 6, 'g'],
  ['Christopher', 21, 6, 'g'],
  ['Alejandro', 23, 6, 'y'],
  ['Dario Calero', 4, 16, 'g'],
  ['paulotijero', 6, 16, 'y'],
  ['Mili', 13, 17, 'r'],
  ['Sebastian Rios', 15, 17, 'g'],
  ['Angélica', 26, 17, 'g'],
  ['Alvaro Torres', 34, 16, 'g'],
  ['Jimmy Loloy', 36, 16, 'g'],
  ['Anderson', 4, 26, 'r'],
  ['Pablo', 6, 26, 'g'],
  ['Nimer Cerna', 5, 27, 'g'],
  ['Jean', 7, 27, 'g'],
  ['Milko', 17, 26, 'g'],
  ['DiegoLopez', 19, 26, 'g'],
  ['Jordan Távara', 20, 28, 'g'],
  ['Alberto', 28, 26, 'g'],
  ['Fernando.Aquino', 30, 26, 'g'],
  ['Paul Llanque', 31, 27, 'g'],
  ['Mike Vera', 33, 26, 'g'],
  ['Junior Ange', 5, 38, 'g'],
  ['Paul Tijero', 7, 38, 'g'],
  ['Iberson Silva', 5, 40, 'g'],
  ['Kendry Soto', 8, 40, 'g'],
  ['kevin', 17, 38, 'g'],
  ['ivan herbas', 18, 39, 'g'],
  ['Joaquin', 20, 38, 'g'],
  ['Jeraldine', 29, 38, 'g'],
  ['Alexis Perdomo', 31, 38, 'g'],
  ['Luis', 33, 38, 'r'],
];

export const NPCS: readonly NpcSeed[] = RAW_NPCS.map(([name, tx, ty, status]) => ({
  name,
  tx,
  ty,
  status,
}));
