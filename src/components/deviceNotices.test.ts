import { describe, expect, it } from 'vitest';
import { DEVICE_KINDS, type DeviceNotice } from '../game/mediaDevices';
import { deviceNoticeMessage } from './deviceNotices';

const PROBLEMS = ['permission-denied', 'not-found', 'in-use', 'other', 'lost'] as const;

describe('deviceNoticeMessage (#284)', () => {
  it('denied, missing and busy read differently for the microphone and the camera', () => {
    for (const kind of ['audioinput', 'videoinput'] as const) {
      const messages = (['permission-denied', 'not-found', 'in-use'] as const).map((problem) =>
        deviceNoticeMessage({ kind, problem }),
      );
      expect(new Set(messages).size).toBe(3);
    }
  });

  it('says what happened and what to do about it', () => {
    expect(deviceNoticeMessage({ kind: 'audioinput', problem: 'permission-denied' })).toMatch(/permiso.*micrófono.*barra de direcciones/i);
    expect(deviceNoticeMessage({ kind: 'videoinput', problem: 'not-found' })).toMatch(/ninguna cámara.*Conecta/i);
    expect(deviceNoticeMessage({ kind: 'audioinput', problem: 'in-use' })).toMatch(/otra aplicación.*Ciérrala/i);
    expect(deviceNoticeMessage({ kind: 'audioinput', problem: 'lost' })).toMatch(/desconectó.*predeterminado/i);
    expect(deviceNoticeMessage({ kind: 'audiooutput', problem: 'lost' })).toMatch(/altavoz.*predeterminado/i);
  });

  it('has a message for every kind and problem', () => {
    for (const kind of DEVICE_KINDS) {
      for (const problem of PROBLEMS) {
        const notice: DeviceNotice = { kind, problem };
        expect(deviceNoticeMessage(notice).length).toBeGreaterThan(0);
      }
    }
  });
});
