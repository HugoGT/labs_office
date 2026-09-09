import { describe, expect, it } from 'vitest';
import { resolveLivekitConfig } from './livekitEndpoint';

describe('resolveLivekitConfig', () => {
  it('sin sesion Colyseus (officeEndpoint null), nunca intenta LiveKit (D6)', () => {
    expect(resolveLivekitConfig({ officeEndpoint: null })).toBeNull();
  });

  it('deriva tokenUrl de ws:// a http:// + /livekit/token', () => {
    const config = resolveLivekitConfig({ officeEndpoint: 'ws://localhost:2567' });
    expect(config).not.toBeNull();
    expect(config?.tokenUrl).toBe('http://localhost:2567/livekit/token');
  });

  it('deriva tokenUrl de wss:// a https:// + /livekit/token', () => {
    const config = resolveLivekitConfig({ officeEndpoint: 'wss://oficina.example.com' });
    expect(config?.tokenUrl).toBe('https://oficina.example.com/livekit/token');
  });

  it('una VITE_LIVEKIT_URL configurada gana sobre el default (url del servidor)', () => {
    const config = resolveLivekitConfig({
      officeEndpoint: 'ws://localhost:2567',
      configuredUrl: 'ws://livekit.example.com:7880',
    });
    expect(config?.url).toBe('ws://livekit.example.com:7880');
  });

  it('una VITE_LIVEKIT_URL vacia se apaga a proposito: url queda null (usa la del servidor)', () => {
    const config = resolveLivekitConfig({
      officeEndpoint: 'ws://localhost:2567',
      configuredUrl: '   ',
    });
    expect(config?.url).toBeNull();
  });

  it('sin VITE_LIVEKIT_URL, url es null: el servidor es la fuente de verdad', () => {
    const config = resolveLivekitConfig({ officeEndpoint: 'ws://localhost:2567' });
    expect(config?.url).toBeNull();
  });
});
