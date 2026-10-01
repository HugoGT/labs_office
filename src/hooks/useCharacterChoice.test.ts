import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/authPort';
import type { CharacterCatalog, CharacterPort, SaveCharacterResult } from '../auth/characterPort';
import { decideCharacterStep, useCharacterChoice } from './useCharacterChoice';

const ANA: AuthUser = { uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana' };

const CATALOG: CharacterCatalog = {
  defaultId: 'character-p01-burgundy-suit',
  options: [
    { id: 'character-p01-burgundy-suit', name: 'Mateo', walkUrl: 'w1.png', seatedUrl: 's1.png' },
    { id: 'character-p02-beige-blazer', name: 'Lucia', walkUrl: 'w2.png', seatedUrl: 's2.png' },
  ],
};

function fakePort(overrides: Partial<CharacterPort> = {}): CharacterPort {
  return {
    read: vi.fn(async () => ({ outcome: 'ok' as const, avatarId: 'character-p02-beige-blazer', chosen: false })),
    save: vi.fn(async (avatarId: string) => ({ outcome: 'ok' as const, avatarId })),
    catalog: vi.fn(async () => CATALOG),
    ...overrides,
  };
}

describe('decideCharacterStep', () => {
  it('someone who never chose is asked, with the stored character preselected', () => {
    expect(
      decideCharacterStep({ outcome: 'ok', avatarId: 'character-p02-beige-blazer', chosen: false }, CATALOG, false),
    ).toEqual({ phase: 'choosing', options: CATALOG.options, initialId: 'character-p02-beige-blazer' });
  });

  it('a restored session that already chose enters straight away', () => {
    expect(
      decideCharacterStep({ outcome: 'ok', avatarId: 'character-p02-beige-blazer', chosen: true }, CATALOG, false),
    ).toEqual({ phase: 'resolved' });
  });

  it('a fresh sign-in is asked again, with the saved character preselected', () => {
    expect(
      decideCharacterStep({ outcome: 'ok', avatarId: 'character-p02-beige-blazer', chosen: true }, CATALOG, true),
    ).toEqual({ phase: 'choosing', options: CATALOG.options, initialId: 'character-p02-beige-blazer' });
  });

  it('a stored character the pack no longer offers preselects the pack default', () => {
    expect(
      decideCharacterStep({ outcome: 'ok', avatarId: 'character-p99-gone', chosen: true }, CATALOG, true),
    ).toMatchObject({ phase: 'choosing', initialId: 'character-p01-burgundy-suit' });
  });

  it.each([
    ['no directory on the server', { outcome: 'unavailable' as const }, CATALOG],
    ['a failed read', { outcome: 'failed' as const }, CATALOG],
    ['a catalog it cannot read', { outcome: 'ok' as const, avatarId: 'character-p01-burgundy-suit', chosen: false }, null],
  ])('%s lets the person in with what the server has, never blocking the entrance', (_label, read, catalog) => {
    expect(decideCharacterStep(read, catalog, true)).toEqual({ phase: 'resolved' });
  });
});

describe('useCharacterChoice', () => {
  it('without a port it is resolved from the first render: nothing to choose', () => {
    const { result } = renderHook(() => useCharacterChoice(null, ANA, true, true));

    expect(result.current.flow).toEqual({ phase: 'resolved' });
  });

  it('waits for the name before reading anything', async () => {
    const port = fakePort();

    const { result } = renderHook(() => useCharacterChoice(port, ANA, false, true));
    await act(async () => {});

    expect(result.current.flow).toEqual({ phase: 'pending' });
    expect(port.read).not.toHaveBeenCalled();
  });

  it('without a user it stays pending and reads nothing', async () => {
    const port = fakePort();

    const { result } = renderHook(() => useCharacterChoice(port, null, true, true));
    await act(async () => {});

    expect(result.current.flow).toEqual({ phase: 'pending' });
    expect(port.read).not.toHaveBeenCalled();
  });

  it('once the name is resolved it reads the choice and the catalog, and asks', async () => {
    const port = fakePort();

    const { result } = renderHook(() => useCharacterChoice(port, ANA, true, false));
    await act(async () => {});

    expect(result.current.flow).toMatchObject({ phase: 'choosing', initialId: 'character-p02-beige-blazer' });
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(port.catalog).toHaveBeenCalledTimes(1);
  });

  it('a restored session that already chose resolves without asking', async () => {
    const port = fakePort({
      read: vi.fn(async () => ({ outcome: 'ok' as const, avatarId: 'character-p02-beige-blazer', chosen: true })),
    });

    const { result } = renderHook(() => useCharacterChoice(port, ANA, true, false));
    await act(async () => {});

    expect(result.current.flow).toEqual({ phase: 'resolved' });
  });

  it('choosing saves the character and resolves', async () => {
    const port = fakePort();
    const { result } = renderHook(() => useCharacterChoice(port, ANA, true, false));
    await act(async () => {});

    await act(async () => {
      await result.current.choose('character-p01-burgundy-suit');
    });

    expect(port.save).toHaveBeenCalledWith('character-p01-burgundy-suit');
    expect(result.current.flow).toEqual({ phase: 'resolved' });
    expect(result.current.error).toBeNull();
  });

  it('marks saving while the save is in flight', async () => {
    let release: (value: SaveCharacterResult) => void = () => {};
    const port = fakePort({ save: vi.fn(() => new Promise<SaveCharacterResult>((resolve) => (release = resolve))) });
    const { result } = renderHook(() => useCharacterChoice(port, ANA, true, false));
    await act(async () => {});

    let saving!: Promise<void>;
    act(() => {
      saving = result.current.choose('character-p01-burgundy-suit');
    });
    expect(result.current.saving).toBe(true);

    await act(async () => {
      release({ outcome: 'ok', avatarId: 'character-p01-burgundy-suit' });
      await saving;
    });
    expect(result.current.saving).toBe(false);
  });

  it.each([
    [{ outcome: 'invalid' as const, reason: 'retired-piece' as const }, 'Ese personaje ya no está disponible. Elige otro.'],
    [{ outcome: 'invalid' as const, reason: 'unknown-piece' as const }, 'Ese personaje no existe. Elige otro.'],
    [{ outcome: 'failed' as const }, 'No se pudo guardar tu personaje. Inténtalo de nuevo.'],
  ])('a rejected save (%j) keeps the selector open with a readable error', async (outcome, message) => {
    const port = fakePort({ save: vi.fn(async () => outcome) });
    const { result } = renderHook(() => useCharacterChoice(port, ANA, true, false));
    await act(async () => {});

    await act(async () => {
      await result.current.choose('character-p01-burgundy-suit');
    });

    expect(result.current.flow).toMatchObject({ phase: 'choosing' });
    expect(result.current.error).toBe(message);
  });

  it('a save the server cannot keep (503) lets the person in with the default', async () => {
    const port = fakePort({ save: vi.fn(async () => ({ outcome: 'unavailable' as const })) });
    const { result } = renderHook(() => useCharacterChoice(port, ANA, true, false));
    await act(async () => {});

    await act(async () => {
      await result.current.choose('character-p01-burgundy-suit');
    });

    expect(result.current.flow).toEqual({ phase: 'resolved' });
  });

  it('signing out resets to pending, so the next account is read afresh', async () => {
    const port = fakePort({
      read: vi.fn(async () => ({ outcome: 'ok' as const, avatarId: 'character-p02-beige-blazer', chosen: true })),
    });
    const { result, rerender } = renderHook(
      ({ user }: { user: AuthUser | null }) => useCharacterChoice(port, user, user !== null, false),
      { initialProps: { user: ANA as AuthUser | null } },
    );
    await act(async () => {});
    expect(result.current.flow).toEqual({ phase: 'resolved' });

    rerender({ user: null });
    expect(result.current.flow).toEqual({ phase: 'pending' });

    rerender({ user: ANA });
    await act(async () => {});
    expect(port.read).toHaveBeenCalledTimes(2);
  });
});
