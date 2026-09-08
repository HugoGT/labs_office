/**
 * `mintOfficeToken` es una funcion pura sin tipos de Express (D5's rationale
 * mirrors this): estas pruebas decodifican el JWT con `TokenVerifier` del
 * mismo SDK, que ademas verifica la firma, satisfaciendo dos aserciones a la
 * vez (contenido + firma).
 */

import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { mintOfficeToken } from './livekitToken.ts';

const config = { apiKey: 'devkey', apiSecret: 'un-secreto-suficientemente-largo-para-hs256' };
const permissions = { canPublish: true, canSubscribe: true, canPublishData: true };

describe('mintOfficeToken', () => {
  it('el JWT decodificado trae identity, la sala y los grants pedidos', async () => {
    const token = await mintOfficeToken(config, {
      identity: 'sess-1',
      room: 'office',
      permissions,
    });

    const claims = await new TokenVerifier(config.apiKey, config.apiSecret).verify(token);

    expect(claims.sub).toBe('sess-1');
    expect(claims.video?.room).toBe('office');
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublishData).toBe(true);
  });

  it('expira despues de emitirse', async () => {
    const token = await mintOfficeToken(config, {
      identity: 'sess-1',
      room: 'office',
      permissions,
    });

    const claims = await new TokenVerifier(config.apiKey, config.apiSecret).verify(token);

    // El SDK (jose SignJWT) no fija `iat`, solo `nbf`/`exp` — confirmado por
    // ejecucion, no asumido: `AccessToken.toJwt()` nunca llama a
    // `setIssuedAt()`. `nbf` marca el momento de emision aqui.
    expect(claims.nbf).toBeTypeOf('number');
    expect(claims.exp).toBeTypeOf('number');
    expect(claims.exp as number).toBeGreaterThan(claims.nbf as number);
  });

  it('la firma no verifica contra un secreto distinto al usado para emitir', async () => {
    const token = await mintOfficeToken(config, {
      identity: 'sess-1',
      room: 'office',
      permissions,
    });

    const wrongVerifier = new TokenVerifier(config.apiKey, 'otro-secreto-totalmente-diferente');

    await expect(wrongVerifier.verify(token)).rejects.toThrow();
  });

  it('identidades distintas producen tokens distintos', async () => {
    const a = await mintOfficeToken(config, { identity: 'sess-a', room: 'office', permissions });
    const b = await mintOfficeToken(config, { identity: 'sess-b', room: 'office', permissions });

    expect(a).not.toBe(b);
  });
});
