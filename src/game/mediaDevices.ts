/**
 * Which microphone, speaker and camera to use (#284), as pure rules: no
 * `livekit-client` and no `navigator` here. `livekitRoom.ts` asks the browser
 * and applies the answer; this module only decides.
 */

/** The three kinds a person picks, named as `MediaDeviceInfo.kind` names them. */
export const DEVICE_KINDS = ['audioinput', 'audiooutput', 'videoinput'] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

export interface DeviceOption {
  deviceId: string;
  /** Empty until the browser was granted a permission; the UI names it then. */
  label: string;
}

export type DeviceLists = Readonly<Record<DeviceKind, readonly DeviceOption[]>>;

/** The device picked per kind, `null` for "whatever the system uses". */
export type DevicePreferences = Readonly<Record<DeviceKind, string | null>>;

export const NO_DEVICES: DeviceLists = { audioinput: [], audiooutput: [], videoinput: [] };

export const NO_DEVICE_PREFERENCES: DevicePreferences = { audioinput: null, audiooutput: null, videoinput: null };

/** The slice of `MediaDeviceInfo` these rules read. */
export interface DeviceInfoLike {
  kind: string;
  deviceId: string;
  label: string;
}

/** Chrome's entry that follows the system's own default device. */
const DEFAULT_DEVICE_ID = 'default';

export function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === 'string' && (DEVICE_KINDS as readonly string[]).includes(value);
}

/**
 * What `enumerateDevices` returned, by kind. Before any permission a browser
 * lists one placeholder per kind with an empty id: nothing a person can pick,
 * so it is left out and the selector stays empty until a permission arrives.
 */
export function deviceListsOf(infos: readonly DeviceInfoLike[]): DeviceLists {
  const lists: Record<DeviceKind, DeviceOption[]> = { audioinput: [], audiooutput: [], videoinput: [] };
  for (const info of infos) {
    if (!isDeviceKind(info.kind) || info.deviceId === '') continue;
    const list = lists[info.kind];
    if (list.some((device) => device.deviceId === info.deviceId)) continue;
    list.push({ deviceId: info.deviceId, label: info.label });
  }
  return lists;
}

/**
 * Where to go without a usable pick: the browser's default entry where it has
 * one (Chrome's audio), else the first device, which is what a browser
 * without that entry uses by default.
 */
export function fallbackDevice(devices: readonly DeviceOption[]): string | null {
  if (devices.some((device) => device.deviceId === DEFAULT_DEVICE_ID)) return DEFAULT_DEVICE_ID;
  return devices[0]?.deviceId ?? null;
}

/** The device that serves a pick: the remembered one while connected, else the fallback. */
export function resolveDevice(preferred: string | null, devices: readonly DeviceOption[]): string | null {
  if (preferred !== null && devices.some((device) => device.deviceId === preferred)) return preferred;
  return fallbackDevice(devices);
}

export interface DeviceLoss {
  /** The device in use before the change is no longer connected: the person is told. */
  lost: boolean;
  /** Device to switch to, `null` when nothing has to move (or nothing is left). */
  switchTo: string | null;
}

/**
 * After a device change. `before` is the device in use when the change
 * happened and `previous` the devices listed then; `now` is the one in use
 * after it, since livekit-client may already have moved to another device by
 * itself, and that one is kept. Only a device that was connected can be
 * lost: a remembered one unplugged since the last visit was never in use.
 */
export function deviceLoss(
  before: string | undefined,
  now: string | undefined,
  previous: readonly DeviceOption[],
  devices: readonly DeviceOption[],
): DeviceLoss {
  const listedIn = (list: readonly DeviceOption[], deviceId: string | undefined) =>
    deviceId !== undefined && list.some((device) => device.deviceId === deviceId);
  if (!listedIn(previous, before) || listedIn(devices, before)) return { lost: false, switchTo: null };
  return { lost: true, switchTo: listedIn(devices, now) ? null : fallbackDevice(devices) };
}

/** Why a device could not be used, each with its own explanation in the UI. */
export type MediaFailure = 'permission-denied' | 'not-found' | 'in-use' | 'other';

const FAILURE_BY_NAME: Readonly<Record<string, MediaFailure>> = {
  NotAllowedError: 'permission-denied',
  PermissionDeniedError: 'permission-denied',
  SecurityError: 'permission-denied',
  NotFoundError: 'not-found',
  DevicesNotFoundError: 'not-found',
  // An exact device that is no longer connected.
  OverconstrainedError: 'not-found',
  NotReadableError: 'in-use',
  TrackStartError: 'in-use',
};

/**
 * By the error's `name`, as `getUserMedia` and `setSinkId` reject. Anything
 * else (a publish that timed out, a closed room) is `other`: a generic
 * message is better than a wrong explanation.
 */
export function mediaFailureOf(error: unknown): MediaFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
  return (typeof name === 'string' && FAILURE_BY_NAME[name]) || 'other';
}

/** What the person is told about a device (#284): why it failed, or that it was unplugged. */
export interface DeviceNotice {
  kind: DeviceKind;
  problem: MediaFailure | 'lost';
}
