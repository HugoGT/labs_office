import { describe, expect, it } from 'vitest';
import { audiblePeers, type AudibleInput, type AudioPeer } from './proximityAudio';
import { videoPeers } from './proximityVideo';

/**
 * `videoPeers` es deliberadamente MAS ANGOSTA que `audiblePeers`: el video
 * cuesta mucho mas ancho de banda, asi que solo se pide dentro de una sala
 * compartida (issue #17, decision D8). En el piso abierto nunca se pide
 * video de un par, sin importar el radio.
 */
describe('videoPeers: solo dentro de una sala compartida, nunca en el piso abierto', () => {
  it('piso abierto (room null): no pide video de nadie, aunque haya pares audibles', () => {
    const result = videoPeers({ room: null, audibleSessionIds: ['companero', 'otro'] });

    expect(result).toEqual([]);
  });

  it('en una sala: pide video exactamente para los mismos ids que son audibles', () => {
    const result = videoPeers({ room: 'Sala de Juntas', audibleSessionIds: ['ana', 'beto'] });

    expect(result).toEqual(['ana', 'beto']);
  });

  it('propio sessionId excluido: hereda la exclusion de audiblePeers() sin logica propia', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      room: 'Sala de Juntas',
      status: 'g',
    };
    const peers: AudioPeer[] = [
      { sessionId: 'yo', x: 0, y: 0, room: 'Sala de Juntas', status: 'g' },
      { sessionId: 'companero', x: 0, y: 0, room: 'Sala de Juntas', status: 'g' },
    ];
    const audibleIds = audiblePeers({ self, peers, radius: 9999 });

    const result = videoPeers({ room: self.room, audibleSessionIds: audibleIds });

    expect(result).toEqual(['companero']);
  });

  it('"No molestar" produce video vacio: hereda el aislamiento de audiblePeers()', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      room: 'Sala de Juntas',
      status: 'r',
    };
    const peers: AudioPeer[] = [
      { sessionId: 'companero', x: 0, y: 0, room: 'Sala de Juntas', status: 'g' },
    ];
    const audibleIds = audiblePeers({ self, peers, radius: 9999 });

    const result = videoPeers({ room: self.room, audibleSessionIds: audibleIds });

    expect(result).toEqual([]);
  });
});
