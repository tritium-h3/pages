import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { RegistryEntry } from './registry.js';
import { REGISTRY } from './registry.js';
import type { ExperimentPageProps } from './platform/manifest.js';
import { matchRoute } from './router.js';
import { Gallery } from './platform/ui/Gallery.js';
import { Shell } from './platform/ui/Shell.js';
import './platform/ui/tokens.css';

/** lazy() must not run during render — a fresh component identity each pass
 *  remounts the page and throws away its state. Cache one per experiment. */
const pageCache = new Map<string, ComponentType<ExperimentPageProps>>();

function pageFor(id: string, load: NonNullable<RegistryEntry['load']>) {
  let Page = pageCache.get(id);
  if (!Page) {
    Page = lazy(load);
    pageCache.set(id, Page);
  }
  return Page;
}

export default function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  const navigate = useCallback((path: string) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, '', path);
    setPathname(path);
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const localCount = useMemo(() => REGISTRY.filter(entry => !entry.external).length, []);
  const match = matchRoute(pathname, REGISTRY);

  if (pathname === '/' || pathname === '') {
    return <Gallery onNavigate={navigate} />;
  }

  if (!match) {
    return (
      <Shell chrome="colophon" experimentCount={localCount} onNavigate={navigate}>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: 40 }}>
          <h1>Nothing here</h1>
          <p>No experiment owns <code>{pathname}</code>.</p>
        </main>
      </Shell>
    );
  }

  const Page = pageFor(match.entry.id, match.entry.load!);
  return (
    <Shell chrome={match.entry.chrome} experimentCount={localCount} onNavigate={navigate}>
      <Suspense fallback={null}>
        <Page subpath={match.subpath} />
      </Suspense>
    </Shell>
  );
}
