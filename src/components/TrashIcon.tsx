/**
 * The delete icon of a desk row (Editar espacios). Drawn with `currentColor`,
 * so the button that holds it (`DeskEditorSection.module.css` `.danger`) sets
 * the red; the button carries the accessible name, the icon is decoration.
 */
export function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}
