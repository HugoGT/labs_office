import { afterEach, describe, expect, it } from 'vitest';
import { isEditableElementFocused } from './inputFocusGuard';

/**
 * Pure guard (#104): WASD must not drive `OfficeScene` movement while the
 * user is typing into a text field of the side panel (or any other form).
 * Tested here against jsdom's `document` directly -- no Phaser involved --
 * and exercised again end-to-end in `OfficeScene.browser.test.ts`.
 */

const elements: HTMLElement[] = [];

afterEach(() => {
  for (const el of elements.splice(0)) el.remove();
  (document.activeElement as HTMLElement | null)?.blur();
});

function focus<T extends HTMLElement>(el: T): T {
  document.body.append(el);
  elements.push(el);
  el.focus();
  return el;
}

describe('isEditableElementFocused', () => {
  it('is false when nothing (or <body>) has focus', () => {
    expect(isEditableElementFocused()).toBe(false);
  });

  it('is true when an <input> has focus', () => {
    focus(document.createElement('input'));
    expect(isEditableElementFocused()).toBe(true);
  });

  it('is true when a <textarea> has focus', () => {
    focus(document.createElement('textarea'));
    expect(isEditableElementFocused()).toBe(true);
  });

  it('is true when a contenteditable element has focus', () => {
    const div = document.createElement('div');
    // jsdom does not implement the `contentEditable` IDL reflection (unlike
    // every real browser), so the content attribute is set directly.
    div.setAttribute('contenteditable', 'true');
    div.tabIndex = 0;
    focus(div);
    expect(isEditableElementFocused()).toBe(true);
  });

  it('is false when a non-editable element such as a button has focus', () => {
    focus(document.createElement('button'));
    expect(isEditableElementFocused()).toBe(false);
  });
});
