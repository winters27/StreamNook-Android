// Mobile shell boot orchestration.
//
// DELIBERATE DUPLICATION, KEEP IN SYNC: the desktop boot lives inline in
// src/App.tsx (the big effect starting near line 537). We replicate the
// SHELL-AGNOSTIC calls here rather than extracting a shared hook, because the
// desktop closure interleaves them with desktop-only listeners and splitting it
// is the riskiest refactor in the repo. When a dev merge adds a new boot step
// to App.tsx, decide whether it belongs here too (see the mobile-port plan and
// the cross-reference comment in App.tsx).
//
// Phase 1 scope: settings -> auth -> boot overlay drop. Later phases add the
// cosmetics prefetch block, 7TV listeners, badge feed, drops cache, deep links,
// presence, registries, and the periodic auth recheck.
import { useEffect } from 'react';
import { useAppStore } from '../../stores/AppStore';

export function useMobileBoot(): void {
  const loadSettings = useAppStore((s) => s.loadSettings);
  const checkAuthStatus = useAppStore((s) => s.checkAuthStatus);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        await loadSettings();
        await checkAuthStatus();
      } finally {
        // Auth resolved (logged in or confirmed logged out) or a boot step
        // failed; either way drop the boot overlay.
        if (!cancelled) useAppStore.setState({ isBooting: false });
      }
    };
    void initialize();

    return () => {
      cancelled = true;
    };
    // Boot runs once; the store functions are stable references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
