import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, type ServiceWorkerHost } from './registerServiceWorker';

function fakeHost(register: ServiceWorkerHost['register'] = vi.fn(async () => ({}))): ServiceWorkerHost {
  return { register };
}

describe('registerServiceWorker (#13)', () => {
  it('registers the generated worker for the whole origin', async () => {
    const host = fakeHost();
    await registerServiceWorker(host);
    expect(host.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('never listens for a new worker taking control, so a deploy never reloads an open office', async () => {
    const host = { ...fakeHost(), addEventListener: vi.fn() };
    await registerServiceWorker(host);
    expect(host.addEventListener).not.toHaveBeenCalled();
  });

  it('keeps the app running when registration fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = fakeHost(vi.fn(async () => Promise.reject(new Error('insecure context'))));
    await expect(registerServiceWorker(host)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
