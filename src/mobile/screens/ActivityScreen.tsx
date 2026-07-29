// Activity: drops progress and rewards. Uses the same backend surface as the
// desktop Drops Center; connecting uses the device-code flow directly (the
// desktop's authorize popup is desktop-gated), showing the code here and
// opening the browser, mirroring the main Twitch login pattern on mobile.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowSquareOut, CheckCircle, Gift } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { PullToRefresh } from '../ui/PullToRefresh';
import { getAllUserBadgesWithEarned } from '../../services/badgeService';
import {
  deriveBadgeStatus,
  formatBadgeDateInfo,
  type BadgeWindowStatus,
} from '../../utils/badgeWindow';
import { Logger } from '../../utils/logger';
import type { DropsDeviceCodeInfo, InventoryItem, InventoryResponse } from '../../types';

type ActivityTab = 'drops' | 'badges';

// Mirrors the desktop Global Cosmetics gallery: newest first, with each
// badge's live earn status derived from its BadgeBase window.
interface GlobalBadge {
  key: string;
  title: string;
  image: string;
  /** Precomputed newest-first rank from the badge metadata cache. */
  position: number;
  status: BadgeWindowStatus | null;
  dateInfo: string;
}
interface GlobalBadgeVersion {
  id?: string;
  title?: string;
  image_url_2x?: string;
  image_url_4x?: string;
}
interface GlobalBadgeSet {
  set_id?: string;
  versions?: GlobalBadgeVersion[];
}
interface GlobalBadgeResponse {
  data?: GlobalBadgeSet[];
}
interface CachedBadgeMeta {
  data?: { more_info?: string | null; enrichment?: Record<string, unknown> | null };
  position?: number;
}

export const ActivityScreen: React.FC = () => {
  const addToast = useAppStore((s) => s.addToast);
  const currentUser = useAppStore((s) => s.currentUser);
  const [tab, setTab] = useState<ActivityTab>('drops');
  const [globalBadges, setGlobalBadges] = useState<GlobalBadge[]>([]);
  const [ownedTitles, setOwnedTitles] = useState<Set<string>>(new Set());
  const [badgesLoading, setBadgesLoading] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [deviceCode, setDeviceCode] = useState<DropsDeviceCodeInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const ok = await invoke<boolean>('is_drops_authenticated');
      setAuthed(ok);
      if (ok) {
        const inv = await invoke<InventoryResponse>('get_drops_inventory').catch(() => null);
        setInventory(inv);
      }
    } catch (err) {
      Logger.warn('[Activity] load failed:', err);
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The GLOBAL Twitch badge collection (every badge currently available),
  // with the ones you already own marked. Same sources the desktop badge wall
  // uses: the cached global badge set, plus your earned set for ownership.
  const loadBadges = useCallback(async () => {
    setBadgesLoading(true);
    try {
      let global = await invoke<GlobalBadgeResponse | null>('get_cached_global_badges');
      if (!global?.data?.length) {
        await invoke('prefetch_global_badges').catch(() => {});
        global = await invoke<GlobalBadgeResponse | null>('get_cached_global_badges');
      }

      // Badge metadata (earn window + newest-first position) comes from the
      // universal cache in one batch, keyed exactly as the desktop gallery
      // keys it.
      let meta: Record<string, CachedBadgeMeta> = {};
      try {
        meta =
          (await invoke<Record<string, CachedBadgeMeta>>('get_all_universal_cached_items', {
            cacheType: 'badge',
          })) ?? {};
      } catch (err) {
        Logger.warn('[Activity] badge metadata cache unavailable:', err);
      }

      const seen = new Set<string>();
      const all: GlobalBadge[] = [];
      for (const set of global?.data ?? []) {
        for (const v of set.versions ?? []) {
          const image = v.image_url_4x || v.image_url_2x;
          if (!v.title || !image) continue;
          if (seen.has(v.title)) continue; // same badge repeats across sets
          seen.add(v.title);
          const cached = meta[`metadata:${set.set_id}-v${v.id}`];
          all.push({
            key: `${set.set_id}-${v.id}`,
            title: v.title,
            image,
            position: typeof cached?.position === 'number' ? cached.position : Number.MAX_SAFE_INTEGER,
            status: deriveBadgeStatus(cached?.data?.more_info, cached?.data?.enrichment),
            dateInfo: formatBadgeDateInfo(cached?.data?.more_info),
          });
        }
      }
      // Newest first by the precomputed position, exactly like the desktop
      // gallery's default sort; anything without metadata sinks to the end.
      all.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
      setGlobalBadges(all);

      const uid = currentUser?.user_id;
      const login = currentUser?.login || currentUser?.username;
      if (uid && login) {
        const mine = await getAllUserBadgesWithEarned(uid, login, uid, login);
        setOwnedTitles(new Set((mine.earnedBadges ?? []).map((b) => b.title)));
      }
    } catch (err) {
      Logger.warn('[Activity] badge load failed:', err);
    } finally {
      setBadgesLoading(false);
    }
  }, [currentUser?.user_id, currentUser?.login, currentUser?.username]);

  useEffect(() => {
    if (tab === 'badges' && globalBadges.length === 0) void loadBadges();
  }, [tab, globalBadges.length, loadBadges]);

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const info = await invoke<DropsDeviceCodeInfo>('start_drops_device_flow');
      setDeviceCode(info);
      // Copy the code up front, then authorize in the SAME in-app WebView the
      // main Twitch login uses (no external browser). The overlay covers the
      // app, so the code must already be on the clipboard when it opens.
      try {
        await navigator.clipboard.writeText(info.user_code);
      } catch {
        /* the code card stays visible behind the overlay regardless */
      }
      await invoke('open_mobile_login', { url: info.verification_uri }).catch(() => {});
      await invoke('poll_drops_token', {
        deviceCode: info.device_code,
        interval: info.interval,
        expiresIn: info.expires_in,
      });
      setDeviceCode(null);
      addToast('Drops connected!', 'success');
      // Trust the successful poll like desktop does; load() then fills the
      // inventory (and the backend check now agrees post-connect).
      setAuthed(true);
      await load();
    } catch (err) {
      // Surface the real backend reason (expired code, denied, network) instead
      // of a generic failure, so a stuck connect is diagnosable from the phone.
      const reason = err instanceof Error ? err.message : String(err);
      Logger.error('[Activity] drops connect failed:', err);
      setConnectError(reason);
      addToast(`Drops connection failed: ${reason}`, 'error');
      setDeviceCode(null);
    } finally {
      await invoke('close_mobile_login').catch(() => {});
      setConnecting(false);
    }
  };

  const copyCode = async () => {
    if (!deviceCode) return;
    try {
      await navigator.clipboard.writeText(deviceCode.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the code stays visible regardless */
    }
  };

  const availableCount = globalBadges.filter(
    (b) => b.status === 'available' && !ownedTitles.has(b.title),
  ).length;

  const inProgress = (inventory?.items ?? []).filter(
    (i: InventoryItem) => i.status === 'Active' || i.drops_in_progress > 0,
  );
  const completed = inventory?.completed_drops ?? [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <h1 className="text-xl font-bold text-textPrimary mb-2.5">Activity</h1>
        <div className="flex gap-1">
          {(['drops', 'badges'] as ActivityTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-full text-sm transition-colors ${
                tab === t ? 'glass-button-static text-textPrimary font-semibold' : 'text-textMuted'
              }`}
            >
              {t === 'drops' ? 'Drops' : 'Badges'}
            </button>
          ))}
        </div>
      </div>
      <PullToRefresh onRefresh={tab === 'drops' ? load : loadBadges}>
        <div className={`px-4 sn-tabbar-clearance ${tab === 'badges' ? '' : 'hidden'}`}>
          {badgesLoading && globalBadges.length === 0 ? (
            <div className="py-10 text-center text-sm text-textMuted">Loading badges…</div>
          ) : globalBadges.length === 0 ? (
            <div className="py-10 text-center text-sm text-textMuted">
              No badges available right now.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 pt-1 pb-2">
                <span className="text-[12px] text-textMuted">
                  {ownedTitles.size} of {globalBadges.length} collected
                </span>
                {availableCount > 0 && (
                  <span className="text-[12px] text-success font-medium">
                    {availableCount} available now
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {globalBadges.map((badge) => {
                  const owned = ownedTitles.has(badge.title);
                  const available = badge.status === 'available';
                  const comingSoon = badge.status === 'coming-soon';
                  return (
                    <div
                      key={badge.key}
                      className={`glass-panel p-2 flex flex-col items-center gap-1.5 relative ${
                        available && !owned ? 'ring-1 ring-success/70' : ''
                      } ${owned ? 'ring-1 ring-accent/60' : ''}`}
                    >
                      <img
                        src={badge.image}
                        alt=""
                        loading="lazy"
                        className={`w-11 h-11 object-contain ${
                          owned || available ? '' : 'opacity-45 grayscale'
                        }`}
                        draggable={false}
                      />
                      <span
                        className={`text-[10.5px] text-center line-clamp-2 leading-tight ${
                          owned || available ? 'text-textPrimary' : 'text-textMuted'
                        }`}
                      >
                        {badge.title}
                      </span>
                      {/* Live earn status: owned wins, then the window state. */}
                      {owned ? (
                        <span className="text-[9.5px] font-semibold text-accent leading-none">
                          OWNED
                        </span>
                      ) : available ? (
                        <span className="text-[9.5px] font-semibold text-success leading-none">
                          AVAILABLE
                        </span>
                      ) : comingSoon ? (
                        <span className="text-[9.5px] font-semibold text-warning leading-none">
                          SOON
                        </span>
                      ) : (
                        <span className="text-[9.5px] text-textMuted leading-none">
                          {badge.dateInfo ? 'ENDED' : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className={`px-4 sn-tabbar-clearance ${tab === 'drops' ? '' : 'hidden'}`}>
          {authed === false && (
            <div className="glass-panel p-4 mt-2">
              <div className="flex items-center gap-2 mb-1.5">
                <Gift size={18} className="text-accent" />
                <span className="text-[15px] font-semibold text-textPrimary">Twitch Drops</span>
              </div>
              <p className="text-[13px] text-textSecondary mb-3 leading-relaxed">
                Connect drops to track campaign progress and earn while you watch.
              </p>
              {deviceCode ? (
                <div className="text-center">
                  <button
                    onClick={copyCode}
                    className="glass-input w-full py-3 font-mono text-2xl tracking-[0.3em] text-textPrimary"
                  >
                    {deviceCode.user_code}
                  </button>
                  <div className="text-[12px] text-textMuted mt-1.5 min-h-[16px]">
                    {copied ? 'Copied' : 'Code copied. Paste it on the Twitch page that opens.'}
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-[12.5px] text-textMuted mt-2">
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                    Waiting for authorization…
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => void connect()}
                    disabled={connecting}
                    className="glass-button sn-touch w-full text-[14px] font-semibold text-textPrimary disabled:opacity-60 flex items-center justify-center gap-1.5"
                  >
                    Connect drops
                    <ArrowSquareOut size={15} />
                  </button>
                  {connectError && (
                    <div className="mt-2 text-[12px] text-error leading-snug break-words">
                      {connectError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {authed && (
            <>
              <div className="text-[12px] font-semibold text-textMuted uppercase tracking-wide mt-2 mb-1.5">
                In progress
              </div>
              {inProgress.length === 0 ? (
                <div className="glass-panel p-4 text-[13px] text-textMuted">
                  No drop campaigns in progress. Watch a drops-enabled stream to start earning.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {inProgress.map((item) => (
                    <div key={item.campaign.id} className="glass-panel p-2.5 flex gap-2.5">
                      {/* Campaign / category art, like the desktop drop cards. */}
                      {item.campaign.image_url && (
                        <img
                          src={item.campaign.image_url}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          className="w-[52px] shrink-0 aspect-[3/4] object-cover rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13.5px] font-medium text-textPrimary truncate">
                            {item.campaign.name}
                          </span>
                          <span className="text-[12px] text-textMuted shrink-0">
                            {item.claimed_drops}/{item.total_drops}
                          </span>
                        </div>
                        {item.campaign.game_name && (
                          <div className="text-[12px] text-textMuted truncate mt-0.5 mb-1.5">
                            {item.campaign.game_name}
                          </div>
                        )}
                        <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent transition-[width]"
                            style={{ width: `${Math.min(100, item.progress_percentage)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {completed.length > 0 && (
                <>
                  <div className="text-[12px] font-semibold text-textMuted uppercase tracking-wide mt-4 mb-1.5">
                    Recently earned
                  </div>
                  <div className="flex flex-col gap-2">
                    {completed.slice(0, 10).map((drop) => (
                      <div key={drop.id} className="glass-panel p-2.5 flex items-center gap-2.5">
                        {drop.image_url ? (
                          <img
                            src={drop.image_url}
                            alt=""
                            className="w-9 h-9 rounded object-cover shrink-0"
                            draggable={false}
                          />
                        ) : (
                          <Gift size={20} className="text-accent shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] text-textPrimary truncate">{drop.name}</div>
                          {drop.game_name && (
                            <div className="text-[12px] text-textMuted truncate">{drop.game_name}</div>
                          )}
                        </div>
                        <CheckCircle size={16} className="text-success shrink-0" />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </PullToRefresh>
    </div>
  );
};
