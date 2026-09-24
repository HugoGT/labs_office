import { describe, expect, it } from 'vitest';
import { PRESENCE_STATUSES } from './officeProtocol';
import { STATUS_COLOR, STATUS_EMOJI, STATUS_LABEL, statusCssColor } from './presence';

describe('presence: vocabulario de presentacion', () => {
  it('mapea cada estado a su color (app.js:53)', () => {
    expect(STATUS_COLOR).toEqual({ g: 0x22c55e, y: 0xeab308, r: 0xef4444 });
  });

  it('las etiquetas describen disponibilidad real, no la agenda de nadie (#1)', () => {
    // "Ausente"/"En reunión" describian a un NPC simulado. Ahora describen a
    // personas de verdad y tienen consecuencias: "Ocupado" sigue escuchando,
    // "No molestar" corta el audio de la oficina.
    expect(STATUS_LABEL).toEqual({
      g: 'En línea',
      y: 'Ocupado',
      r: 'No molestar',
    });
  });

  it('each status has the colored circle that matches its dot (#67)', () => {
    expect(STATUS_EMOJI).toEqual({ g: '🟢', y: '🟡', r: '🔴' });
  });

  it('cada estado del protocolo tiene color y etiqueta: nada queda sin pintar ni sin nombre', () => {
    for (const status of PRESENCE_STATUSES) {
      expect(STATUS_COLOR[status]).toBeTypeOf('number');
      expect(STATUS_LABEL[status]).toBeTruthy();
    }
  });
});

describe('statusCssColor', () => {
  it('traduce el color de Phaser a #rrggbb para el DOM', () => {
    expect(statusCssColor('g')).toBe('#22c55e');
    expect(statusCssColor('y')).toBe('#eab308');
    expect(statusCssColor('r')).toBe('#ef4444');
  });

  it('rellena a seis digitos: un color con ceros a la izquierda seguiria siendo valido', () => {
    // `(0x0022c5).toString(16)` da '22c5', que como color CSS es basura. El
    // relleno es la razon de que esta conversion viva en un solo sitio.
    expect(statusCssColor('g')).toHaveLength(7);
  });
});
