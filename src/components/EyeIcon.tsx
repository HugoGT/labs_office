/**
 * The eye of the login password toggle (#240). Drawn with `currentColor`, so
 * the button that holds it (`LoginScreen.module.css` `.reveal`) sets the
 * color; the button carries the accessible name, the icon is decoration.
 * `crossed` is the "hide" state: the password is visible right now.
 */
export function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M3 3l18 18" />}
    </svg>
  );
}
