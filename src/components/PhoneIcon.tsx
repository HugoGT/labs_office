/**
 * The call icon (#187). The phone emoji it replaces is drawn red by every
 * color emoji font (Noto Color Emoji, Segoe UI Emoji) and `color` cannot
 * change it. Same green as `BottomBar.module.css` `.meDot`, set inline so a
 * hovered menu action (`color: #fff`) does not repaint it.
 */
export const CALL_ICON_COLOR = '#22c55e';

export function PhoneIcon() {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ color: CALL_ICON_COLOR, verticalAlign: '-0.125em', flex: 'none' }}
    >
      <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.32.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z" />
    </svg>
  );
}
