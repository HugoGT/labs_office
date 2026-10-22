/**
 * Icons of the desk hover banner. Drawn with `currentColor`, like
 * `TrashIcon`: the button holds the accessible name, the icon is decoration.
 */

function Icon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      <path d={path} />
    </svg>
  );
}

/** "Mi personaje". */
export function CharacterIcon() {
  return (
    <Icon path="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm0 14c-2.03 0-4.43-.82-6.14-2.88a9.95 9.95 0 0 1 12.28 0C16.43 19.18 14.03 20 12 20z" />
  );
}

/** "Decorar": a potted plant, one of the pieces a desk is decorated with. */
export function DecorateIcon() {
  return (
    <Icon path="M7 14h10l-1.5 7h-7L7 14zm4.5-1C8 13 5.5 10.5 5.5 7c3.5 0 6 2.5 6 6zm1 0c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6zm-.5-2c-1.7-1.7-1.7-5.3 0-7 1.7 1.7 1.7 5.3 0 7z" />
  );
}

/** "Dejar escritorio": an X, not a sign-out arrow, so it does not read as leaving the office. */
export function LeaveIcon() {
  return <Icon path="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />;
}

/** "Reclamar escritorio". */
export function ClaimIcon() {
  return <Icon path="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />;
}
