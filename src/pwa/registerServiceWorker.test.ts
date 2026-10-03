import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, type ServiceWorkerHost } from './registerServiceWorker';

function fakeHost(controller: object | null, register: ServiceWorkerHost['register'] = vi.fn(async () => ({}))) {
  const listeners: Array<() => void> = [];
  const host = {
    controller,
    register,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'controllerchange') listeners.push(listener);
    }),
  };
  /** What the browser does when a worker takes control of the page. */
  const takeControl = (worker: object) => {
    host.controller = worker;
    for (const listener of listeners) listener();
  };
  return { host, takeControl };
}

describe('registerServiceWorker (#13)', () => {
  it('registers the generated worker for the whole origin', async () => {
    const { host } = fakeHost(null);
    await registerServiceWorker(host, vi.fn());
    expect(host.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('does not reload when the first worker claims a page it did not serve', async () => {
    const { host, takeControl } = fakeHost(null);
    const reload = vi.fn();
    await registerServiceWorker(host, reload);
    takeControl({ version: 1 });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when a new version replaces the worker that served the page', async () => {
    const { host, takeControl } = fakeHost({ version: 1 });
    const reload = vi.fn();
    await registerServiceWorker(host, reload);
    takeControl({ version: 2 });
    takeControl({ version: 3 });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when a later version replaces the first worker of this session', async () => {
    const { host, takeControl } = fakeHost(null);
    const reload = vi.fn();
    await registerServiceWorker(host, reload);
    takeControl({ version: 1 });
    takeControl({ version: 2 });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the app running when registration fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = fakeHost(null, vi.fn(async () => Promise.reject(new Error('insecure context'))));
    await expect(registerServiceWorker(host, vi.fn())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
