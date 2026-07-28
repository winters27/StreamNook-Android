import { useEffect, useState } from 'react';

const QUERY = '(orientation: landscape)';

export function useOrientation(): 'portrait' | 'landscape' {
  const [landscape, setLandscape] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setLandscape(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return landscape ? 'landscape' : 'portrait';
}
