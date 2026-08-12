import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { ChromeMode } from '../manifest.js';
import { Colophon } from './Colophon.js';
import styles from './Shell.module.css';

interface ShellProps {
  chrome: ChromeMode;
  experimentCount: number;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

export function Shell({ chrome, experimentCount, onNavigate, children }: ShellProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Sprite Tool and Image Hunt already bind Escape to cancel a selection or
      // a rename. Without these guards the same keystroke would also navigate
      // home, throwing away whatever the page was in the middle of.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')) {
        return;
      }
      onNavigate('/');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNavigate]);

  return (
    <div className={styles.shell}>
      <div className={styles.content}>{children}</div>
      {chrome === 'colophon' && <Colophon count={experimentCount} onNavigate={onNavigate} />}
    </div>
  );
}
