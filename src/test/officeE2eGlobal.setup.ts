// D2 fallback: Vitest's `test.projects` module runner does not apply the
// root/project `define` for `__OFFICE_E2E__` the same way a real `vite
// build`/`vite dev`/browser-mode page load does (verified empirically: the
// bare identifier threw `ReferenceError` under the jsdom project without
// this). This only patches Vitest's own test environments; the production
// and instrumented builds still rely solely on the `define` in
// `vite.config.ts` for real dead-code elimination.
if (typeof (globalThis as Record<string, unknown>).__OFFICE_E2E__ === 'undefined') {
  (globalThis as Record<string, unknown>).__OFFICE_E2E__ = false;
}
