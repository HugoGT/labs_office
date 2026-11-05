import type { DeviceKind, DeviceNotice } from '../game/mediaDevices';

/**
 * What the person reads when a device fails or goes away (#284): what
 * happened and what they can do, one line each. Before this every failure
 * looked the same: the button did not light up and nothing said why.
 */
const MESSAGES: Record<DeviceKind, Record<DeviceNotice['problem'], string>> = {
  audioinput: {
    'permission-denied':
      '🎙️ El navegador no tiene permiso para usar el micrófono. Permítelo en el candado de la barra de direcciones y vuelve a pulsar Mic',
    'not-found': '🎙️ No se encontró ningún micrófono. Conecta uno y vuelve a pulsar Mic',
    'in-use': '🎙️ Otra aplicación está usando el micrófono. Ciérrala y vuelve a pulsar Mic',
    other: '🎙️ No se pudo encender el micrófono. Vuelve a pulsar Mic en un momento',
    lost: '🎙️ Se desconectó tu micrófono: ahora usas el predeterminado del sistema',
  },
  videoinput: {
    'permission-denied':
      '📷 El navegador no tiene permiso para usar la cámara. Permítelo en el candado de la barra de direcciones y vuelve a pulsar Cámara',
    'not-found': '📷 No se encontró ninguna cámara. Conecta una y vuelve a pulsar Cámara',
    'in-use': '📷 Otra aplicación está usando la cámara. Ciérrala y vuelve a pulsar Cámara',
    other: '📷 No se pudo encender la cámara. Vuelve a pulsar Cámara en un momento',
    lost: '📷 Se desconectó tu cámara: ahora usas otra disponible',
  },
  audiooutput: {
    'permission-denied': '🔈 El navegador no deja elegir el altavoz. Permite el micrófono y vuelve a elegirlo',
    'not-found': '🔈 Ese altavoz ya no está conectado. Elige otro en las opciones del micrófono',
    'in-use': '🔈 No se pudo usar ese altavoz. Elige otro en las opciones del micrófono',
    other: '🔈 No se pudo cambiar el altavoz. Vuelve a elegirlo en un momento',
    lost: '🔈 Se desconectó tu altavoz: el sonido sale por el predeterminado del sistema',
  },
};

export function deviceNoticeMessage({ kind, problem }: DeviceNotice): string {
  return MESSAGES[kind][problem];
}
