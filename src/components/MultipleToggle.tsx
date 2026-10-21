import styles from './MultipleToggle.module.css';

export interface MultipleToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * "Múltiple" (#207), shared by the decor, desk and room editors: off, one
 * click on the map places one piece and the tool is put down; on, the tool
 * stays picked until Escape or "Salir". Presentational: each editor owns the
 * value, which it keeps while the tool is picked, so it is set before.
 */
export function MultipleToggle({ checked, onChange, disabled = false }: MultipleToggleProps) {
  return (
    <label className={styles.toggle}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      Múltiple
    </label>
  );
}
