import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { ChromeMode } from '../manifest.js';
import { Colophon } from './Colophon.js';

interface ShellProps {
  chrome: ChromeMode;
  experimentCount: number;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

export function Shell({ chrome, experimentCount, onNavigate, children }: ShellProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onNavigate('/');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNavigate]);

  return (
    <>
      {children}
      {chrome === 'colophon' && <Colophon count={experimentCount} onNavigate={onNavigate} />}
    </>
  );
}
