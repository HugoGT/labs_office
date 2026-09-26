/**
 * Issue #104: `OfficeScene`'s WASD listener binds on `window` (Phaser's
 * default `input.keyboard.target`, never overridden in `createGame.ts`), so
 * it fires even while the side panel's text fields (`SpaceEditorSection`,
 * `DeskEditorSection`, ...) have focus -- typing "sala" moved the avatar
 * instead of writing the S/A. This is the guard `OfficeScene.update()` checks
 * before reading `this.wasd.*.isDown`: any input/textarea/contenteditable
 * currently focused means "let the field have the keystroke", regardless of
 * which component put it there.
 */
export function isEditableElementFocused(doc: Document = document): boolean {
  const active = doc.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return true;
  if (active.isContentEditable) return true;
  // jsdom (unit tests) does not implement `isContentEditable` at all, unlike
  // every real browser (Chromium included, used by `*.browser.test.ts`), so
  // the attribute is checked directly too -- per spec an empty or "true"
  // `contenteditable` attribute also makes the element an editing host.
  const contentEditable = active.getAttribute('contenteditable');
  return contentEditable === '' || contentEditable === 'true';
}
