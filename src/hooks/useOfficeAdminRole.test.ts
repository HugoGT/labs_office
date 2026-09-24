/**
 * El sondeo del rol administrativo (#74, PR3a): decide que secciones de
 * edicion OFRECE el sidebar (Desks, Spaces). El servidor sigue siendo la
 * unica autoridad para cualquier mutacion (ver `adminRoutes.ts`) -- esto es
 * puramente cosmetico, y por eso el ciclo de vida importa mas que la forma:
 * cuando hay rol, cuando no, y que un fallo no deje pintada una seccion que
 * luego el servidor rechazaria.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '../dashboard/adminPort';
import { useOfficeAdminRole } from './useOfficeAdminRole';

const ENDPOINT = 'ws://oficina.local:2567';
const SESION = { displayName: 'Ana Torres', getIdToken: async () => 'id-token' };

describe('useOfficeAdminRole', () => {
  it('empieza en null: todavia no se sabe el rol de quien mira', () => {
    const { result } = renderHook(() =>
      useOfficeAdminRole(ENDPOINT, SESION, { fetchRole: async () => 'admin' }),
    );

    expect(result.current).toBeNull();
  });

  it('entrega el rol que el servidor reporta', async () => {
    const { result } = renderHook(() =>
      useOfficeAdminRole(ENDPOINT, SESION, { fetchRole: async () => 'superadmin' }),
    );

    await waitFor(() => expect(result.current).toBe('superadmin'));
  });

  it('un empleado sin permisos de administracion tambien es un rol valido', async () => {
    const { result } = renderHook(() =>
      useOfficeAdminRole(ENDPOINT, SESION, { fetchRole: async () => 'employee' }),
    );

    await waitFor(() => expect(result.current).toBe('employee'));
  });

  it('pide GET /admin/session con la url y el token derivados de la sesion', async () => {
    const fetchRole = vi.fn(async () => 'admin' as Role);

    renderHook(() => useOfficeAdminRole(ENDPOINT, SESION, { fetchRole }));

    await waitFor(() =>
      expect(fetchRole).toHaveBeenCalledWith(
        'http://oficina.local:2567/admin',
        SESION.getIdToken,
      ),
    );
  });

  it('sin sesion de Colyseus no hay nada que sondear: se queda en null', () => {
    const fetchRole = vi.fn(async () => 'admin' as Role);

    const { result } = renderHook(() => useOfficeAdminRole(null, SESION, { fetchRole }));

    expect(result.current).toBeNull();
    expect(fetchRole).not.toHaveBeenCalled();
  });

  it('sin sesion autenticada tampoco: no hay token que mandar', () => {
    const fetchRole = vi.fn(async () => 'admin' as Role);

    const { result } = renderHook(() => useOfficeAdminRole(ENDPOINT, null, { fetchRole }));

    expect(result.current).toBeNull();
    expect(fetchRole).not.toHaveBeenCalled();
  });

  it('un fallo (red caida, sin fila en el directorio) deja el rol en null, nunca lo inventa', async () => {
    const fetchRole = vi.fn(async () => null);

    const { result } = renderHook(() => useOfficeAdminRole(ENDPOINT, SESION, { fetchRole }));

    await waitFor(() => expect(fetchRole).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('no vuelve a pedirlo en cada render', async () => {
    const fetchRole = vi.fn(async () => 'admin' as Role);

    const { rerender, result } = renderHook(() =>
      useOfficeAdminRole(ENDPOINT, SESION, { fetchRole }),
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender();
    rerender();

    expect(fetchRole).toHaveBeenCalledTimes(1);
  });

  it('una respuesta que llega tras desmontar no toca el estado', async () => {
    let resolver: ((role: Role | null) => void) | undefined;
    const fetchRole = () =>
      new Promise<Role | null>((resolve) => {
        resolver = resolve;
      });

    const { unmount } = renderHook(() => useOfficeAdminRole(ENDPOINT, SESION, { fetchRole }));
    unmount();

    expect(() => resolver?.('admin')).not.toThrow();
  });
});
