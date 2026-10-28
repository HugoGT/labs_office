import type { ReactNode } from 'react';
import styles from './NoticeStack.module.css';

/** The notices over the bottom bar, stacked in order: the last one sits nearest the bar. */
export function NoticeStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}
