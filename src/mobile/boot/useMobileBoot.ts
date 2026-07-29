// Mobile shell boot orchestration.
//
// DELIBERATE DUPLICATION, KEEP IN SYNC: the desktop boot lives inline in
// src/App.tsx (the big effect starting near line 537). We replicate the
// SHELL-AGNOSTIC calls here rather than extracting a shared hook, because the
// desktop closure interleaves them with desktop-only listeners and splitting it
// is the riskiest refactor in the repo. When a dev merge adds a new boot step
// to App.tsx, decide whether it belongs here too (see the cross-reference
// comment in App.tsx).
//
// Deliberately NOT replicated (desktop-only surfaces): session resume, whisper
// import, eventsub://channel-moderate (mod tools), drop-progress automation,
// snippet sync, window sizing, universal-cache disk sync (features.assetDiskCache).
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../stores/AppStore';
import {
  handleSeventvCosmeticUpdate,
  handleSeventvEmoteSetUpdate,
  type CosmeticUpdatePayload,
  type EmoteSetUpdatePayload,
} from '../../services/seventvEventApi';
import {
  incrementStat,
  isSupabaseConfigured,
  refreshEntitlementRegistries,
  subscribeToAtmospheresRegistry,
  subscribeToCosmeticsRegistry,
  subscribeToStreamNookRegistry,
  trackPresence,
} from '../../services/supabaseService';
import { postSystemNotification } from '../notifications';
import { Logger } from '../../utils/logger';

export function useMobileBoot(): void {
  useEffect(() => {
    let isMounted = true;
    const cleanupFunctions: (() => void)[] = [];

    const addListener = async <T,>(event: string, handler: (event: { payload: T }) => void) => {
      try {
        const unlistenFn = await listen<T>(event, handler);
        if (isMounted) cleanupFunctions.push(unlistenFn);
        else unlistenFn();
      } catch (e) {
        Logger.warn(`[MobileBoot] Failed to set up listener for ${event}:`, e);
      }
    };

    const initialize = async () => {
      const store = useAppStore.getState();
      try {
        await store.loadSettings();
        await store.checkAuthStatus();
      } finally {
        // Auth resolved (logged in or confirmed logged out) or a boot step
        // failed; either way drop the boot overlay.
        if (isMounted) useAppStore.setState({ isBooting: false });
      }

      // Active drops cache (1h TTL); powers the Activity surface.
      useAppStore.getState().loadActiveDropsCache();

      // Real-time badge-drop feed (WebSocket + latest.json fallback).
      void import('../../services/badgeSocketService').then(({ startBadgeFeed }) => {
        startBadgeFeed();
      });

      // Pre-fetch cosmetics for the signed-in account(s) so chat and profile
      // paint on frame one. Mirrors the desktop block in App.tsx.
      const { currentUser, isAuthenticated } = useAppStore.getState();
      if (isAuthenticated && currentUser?.user_id) {
        const { registerOwnCosmeticAccounts, revalidateOwnCosmetics, getFullProfileWithFallback } =
          await import('../../services/cosmeticsCache');
        const { seedOwnIdentitiesFromCache, getResolvedIdentity, getIdentityWithCache } =
          await import('../../services/identityService');
        const { registerOwnAtmospheres } = await import('../../stores/chatUserStore');
        const { listAccounts } = await import('../../services/accountService');
        const selfId = currentUser.user_id;
        const selfLogin = currentUser.login || currentUser.username;

        let accountIds = [selfId];
        try {
          const ids = (await listAccounts()).map((a) => a.user_id).filter(Boolean);
          if (ids.length) accountIds = ids.includes(selfId) ? ids : [...ids, selfId];
        } catch {
          /* account registry not ready yet — fall back to the active account */
        }

        registerOwnCosmeticAccounts(accountIds);
        seedOwnIdentitiesFromCache(accountIds);
        registerOwnAtmospheres(accountIds);

        revalidateOwnCosmetics(selfId)
          .then(() => getFullProfileWithFallback(selfId, selfLogin, selfId, selfLogin))
          .catch((err: Error) =>
            Logger.error('[MobileBoot] Failed to pre-fetch user profile:', err),
          );
        getResolvedIdentity(selfId).catch(() => {});
        getIdentityWithCache(selfId).catch(() => {});
        for (const id of accountIds) {
          if (id === selfId) continue;
          revalidateOwnCosmetics(id).catch(() => {});
          getResolvedIdentity(id).catch(() => {});
          getIdentityWithCache(id).catch(() => {});
        }
      }

      // Live 7TV emote-set updates + cosmetics pushed from the Rust EventAPI socket.
      await addListener<EmoteSetUpdatePayload>('7tv://emote-set-update', (event) => {
        void handleSeventvEmoteSetUpdate(event.payload);
      });
      await addListener<CosmeticUpdatePayload>('7tv://cosmetic-update', (event) => {
        void handleSeventvCosmeticUpdate(event.payload);
      });

      // Channel points auto-claims from the Rust watcher.
      await addListener<{ points_earned: number }>('channel-points-claimed', (event) => {
        const claim = event.payload;
        useAppStore.getState().addToast(`Claimed ${claim.points_earned} channel points!`, 'success');
        if (isSupabaseConfigured()) {
          const { currentUser: user, isAuthenticated: authed } = useAppStore.getState();
          if (authed && user?.user_id) {
            void incrementStat(user.user_id, 'channel_points_collected', claim.points_earned);
          }
        }
      });

      // Ad auto-pivot: backend re-resolved a clean player URL; applying it
      // changes streamUrl, which the mobile hls engine reloads from.
      await addListener<{ url: string; region?: string; channel?: string }>('ad-pivot', (event) => {
        const { url, region } = event.payload;
        if (url) useAppStore.getState().applyAdPivot(url, region);
      });

      // Follow/unfollow actions elsewhere ask the shell to refresh the list.
      await addListener<void>('refresh-following-list', () => {
        void useAppStore.getState().loadFollowedStreams();
      });

      // Live channel alerts land in the system shade, which is the only
      // surface that works when the app is backgrounded. The desktop routes
      // this same event to a toast / Dynamic Island; on a phone the OS owns it.
      await addListener<{
        streamer_name: string;
        game_name?: string;
        stream_title?: string;
        streamer_avatar?: string;
        is_test?: boolean;
      }>('show-live-toast', (event) => {
        const n = event.payload;
        const prefs = useAppStore.getState().settings.live_notifications;
        if (prefs?.show_live_notifications === false) return;
        void postSystemNotification({
          title: `${n.streamer_name} is live`,
          body: n.stream_title || (n.game_name ? `Playing ${n.game_name}` : undefined),
          icon: n.streamer_avatar,
        });
      });

      // Supabase presence + the server-driven registries (membership, cosmetics
      // catalog + ownership, atmospheres). Without these the cosmetics surfaces
      // read empty: getOwnedCosmeticSlugs and friends serve these in-memory
      // registries. Re-pull on return to the app, throttled, using
      // visibilitychange (mobile has no meaningful window focus).
      if (isSupabaseConfigured()) {
        const { currentUser: presenceUser, isAuthenticated: presenceAuthed } =
          useAppStore.getState();
        try {
          const cleanupPresence = await trackPresence(
            presenceAuthed ? presenceUser?.user_id : undefined,
            presenceAuthed ? presenceUser?.display_name : undefined,
            undefined,
          );
          if (cleanupPresence) cleanupFunctions.push(cleanupPresence);
        } catch (e) {
          Logger.warn('[MobileBoot] presence failed:', e);
        }

        const cleanupRegistry = subscribeToStreamNookRegistry();
        const cleanupCosmetics = subscribeToCosmeticsRegistry();
        const cleanupAtmospheres = subscribeToAtmospheresRegistry();
        cleanupFunctions.push(() => {
          cleanupRegistry?.();
          cleanupCosmetics?.();
          cleanupAtmospheres?.();
        });

        let lastResync = 0;
        const onVisible = () => {
          if (document.visibilityState !== 'visible') return;
          const now = Date.now();
          if (now - lastResync < 10_000) return;
          lastResync = now;
          refreshEntitlementRegistries();
        };
        document.addEventListener('visibilitychange', onVisible);
        cleanupFunctions.push(() =>
          document.removeEventListener('visibilitychange', onVisible),
        );
      }
    };
    void initialize();

    // Periodic auth recheck: keeps tokens fresh across long sessions.
    const authInterval = setInterval(() => {
      void useAppStore.getState().checkAuthStatus();
    }, 5 * 60 * 1000);
    cleanupFunctions.push(() => clearInterval(authInterval));

    return () => {
      isMounted = false;
      for (const fn of cleanupFunctions) fn();
    };
    // Boot runs once; everything is read through getState().
  }, []);
}
