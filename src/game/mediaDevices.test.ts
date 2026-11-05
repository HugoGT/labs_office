import { describe, expect, it } from 'vitest';
import {
  NO_DEVICES,
  deviceListsOf,
  deviceLoss,
  fallbackDevice,
  mediaFailureOf,
  resolveDevice,
  type DeviceOption,
} from './mediaDevices';

const MICS: DeviceOption[] = [
  { deviceId: 'default', label: 'Predeterminado - Interno' },
  { deviceId: 'interno', label: 'Interno' },
  { deviceId: 'headset', label: 'Headset USB' },
];

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('deviceListsOf', () => {
  it('splits what the browser lists by kind, in its order', () => {
    const lists = deviceListsOf([
      { kind: 'audioinput', deviceId: 'default', label: 'Predeterminado' },
      { kind: 'videoinput', deviceId: 'cam1', label: 'FaceTime' },
      { kind: 'audiooutput', deviceId: 'default', label: 'Altavoces' },
      { kind: 'audioinput', deviceId: 'headset', label: 'Headset' },
    ]);

    expect(lists.audioinput.map((device) => device.deviceId)).toEqual(['default', 'headset']);
    expect(lists.videoinput).toEqual([{ deviceId: 'cam1', label: 'FaceTime' }]);
    expect(lists.audiooutput).toEqual([{ deviceId: 'default', label: 'Altavoces' }]);
  });

  it('leaves out the placeholders a browser lists before any permission: they have no id to pick', () => {
    const lists = deviceListsOf([
      { kind: 'audioinput', deviceId: '', label: '' },
      { kind: 'videoinput', deviceId: '', label: '' },
    ]);

    expect(lists).toEqual(NO_DEVICES);
  });

  it('keeps one entry per id and ignores kinds it does not pick from', () => {
    const lists = deviceListsOf([
      { kind: 'audioinput', deviceId: 'a', label: 'A' },
      { kind: 'audioinput', deviceId: 'a', label: 'A otra vez' },
      { kind: 'other', deviceId: 'x', label: 'X' },
    ]);

    expect(lists.audioinput).toEqual([{ deviceId: 'a', label: 'A' }]);
  });
});

describe('fallbackDevice', () => {
  it("prefers the browser's own default entry, which follows the system", () => {
    expect(fallbackDevice(MICS)).toBe('default');
  });

  it('takes the first device where the browser has no default entry (Firefox, cameras)', () => {
    expect(fallbackDevice([{ deviceId: 'cam1', label: '' }, { deviceId: 'cam2', label: '' }])).toBe('cam1');
  });

  it('has nothing to fall back to without devices', () => {
    expect(fallbackDevice([])).toBeNull();
  });
});

describe('resolveDevice', () => {
  it('is the remembered device while it is connected', () => {
    expect(resolveDevice('headset', MICS)).toBe('headset');
  });

  it('is the fallback when nothing was picked or the pick is not connected', () => {
    expect(resolveDevice(null, MICS)).toBe('default');
    expect(resolveDevice('desenchufado', MICS)).toBe('default');
  });
});

describe('deviceLoss', () => {
  it('nothing lost while the device in use is still listed', () => {
    expect(deviceLoss('headset', 'headset', MICS, MICS)).toEqual({ lost: false, switchTo: null });
  });

  it('nothing lost when no device was in use yet', () => {
    expect(deviceLoss(undefined, undefined, MICS, MICS)).toEqual({ lost: false, switchTo: null });
  });

  it('the device in use is gone: lost, and switches to the fallback', () => {
    const now = MICS.filter((device) => device.deviceId !== 'headset');

    expect(deviceLoss('headset', 'headset', MICS, now)).toEqual({ lost: true, switchTo: 'default' });
  });

  it('lost but already moved to a connected device (the SDK switched by itself): nothing to switch', () => {
    const before = [{ deviceId: 'cam1', label: '' }, { deviceId: 'cam2', label: '' }];
    const now = [{ deviceId: 'cam2', label: '' }];

    expect(deviceLoss('cam1', 'cam2', before, now)).toEqual({ lost: true, switchTo: null });
  });

  it('lost with nothing left to use: told, nothing to switch to', () => {
    expect(deviceLoss('headset', 'headset', MICS, [])).toEqual({ lost: true, switchTo: null });
  });

  it('a remembered device that was already missing is not lost now: it was never in use here', () => {
    const now = [{ deviceId: 'default', label: '' }];

    expect(deviceLoss('headset', 'headset', now, now)).toEqual({ lost: false, switchTo: null });
  });
});

describe('mediaFailureOf', () => {
  it('tells a denied permission apart', () => {
    expect(mediaFailureOf(domError('NotAllowedError'))).toBe('permission-denied');
    expect(mediaFailureOf(domError('PermissionDeniedError'))).toBe('permission-denied');
    expect(mediaFailureOf(domError('SecurityError'))).toBe('permission-denied');
  });

  it('tells a missing device apart, a remembered one that is gone included', () => {
    expect(mediaFailureOf(domError('NotFoundError'))).toBe('not-found');
    expect(mediaFailureOf(domError('DevicesNotFoundError'))).toBe('not-found');
    expect(mediaFailureOf(domError('OverconstrainedError'))).toBe('not-found');
  });

  it('tells a device another app holds apart', () => {
    expect(mediaFailureOf(domError('NotReadableError'))).toBe('in-use');
    expect(mediaFailureOf(domError('TrackStartError'))).toBe('in-use');
  });

  it('anything else is a generic failure, never a wrong explanation', () => {
    expect(mediaFailureOf(new Error('publishing rejected as engine not connected'))).toBe('other');
    expect(mediaFailureOf('boom')).toBe('other');
    expect(mediaFailureOf(undefined)).toBe('other');
  });
});
