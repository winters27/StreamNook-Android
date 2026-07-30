// Activity: drops progress and rewards. Uses the same backend surface as the
// desktop Drops Center; connecting uses the device-code flow directly (the
// desktop's authorize popup is desktop-gated), showing the code here and
// opening the browser, mirroring the main Twitch login pattern on mobile.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowSquareOut, CalendarBlank, CheckCircle, Gift, Warning } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import { PullToRefresh } from '../ui/PullToRefresh';
import { MobileSheet } from '../ui/MobileSheet';
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
  setId: string;
  versionId: string;
  title: string;
  description: string;
  image: string;
  /** Precomputed newest-first rank from the badge metadata cache. */
  position: number;
  /** Parsed date_added, the authoritative newest-first key. */
  addedMs: number;
  usage: number;
  status: BadgeWindowStatus | null;
  dateInfo: string;
  moreInfo: string;
  infoUrl: string;
}

type BadgeSort = 'newest' | 'oldest' | 'available' | 'soon' | 'usage';

const BADGE_SORTS: { id: BadgeSort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'available', label: 'Available' },
  { id: 'soon', label: 'Coming soon' },
  { id: 'usage', label: 'Most used' },
  { id: 'oldest', label: 'Oldest' },
];

// "1,234 users" -> 1234, so the usage sort has something numeric to work with.
function parseUsage(raw: string | null | undefined): number {
  if (!raw) return 0;
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function parseAdded(raw: string | null | undefined): number {
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

// Split a badge blurb into its parts so each gets its own treatment instead of
// one wall of text: the earn prose, the event window line, and any
// eligibility caveat (the "Prime subs don't count" class of parenthetical).
const WINDOW_LINE_RE = /^\s*(?:event duration|available)\s*:?\s*(.+)$/im;
const CAVEAT_RE = /\(([^)]*(?:don't count|do not count|not eligible|excluded|doesn't count)[^)]*)\)/i;

function splitBadgeBlurb(text: string): {
  prose: string;
  window: string | null;
  caveat: string | null;
} {
  if (!text) return { prose: '', window: null, caveat: null };
  let rest = text;

  const win = rest.match(WINDOW_LINE_RE);
  const window = win ? win[1].trim() : null;
  if (win) rest = rest.replace(win[0], '');

  const cav = rest.match(CAVEAT_RE);
  const caveat = cav ? cav[1].trim() : null;
  if (cav) rest = rest.replace(cav[0], '');

  const prose = rest
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { prose, window, caveat };
}
interface GlobalBadgeVersion {
  id?: string;
  title?: string;
  description?: string;
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
  data?: {
    date_added?: string | null;
    usage_stats?: string | null;
    more_info?: string | null;
    enrichment?: Record<string, unknown> | null;
    info_url?: string;
  };
  position?: number;
}

export const ActivityScreen: React.FC = () => {
  const addToast = useAppStore((s) => s.addToast);
  const currentUser = useAppStore((s) => s.currentUser);
  const [tab, setTab] = useState<ActivityTab>('drops');

  // Arriving from a tap on the live drop progress: land on Drops, scroll that
  // campaign into view and flash it, so the jump obviously ends somewhere rather
  // than dumping you at the top of a list to hunt.
  const focusDropCampaignId = useMobileNavStore((s) => s.focusDropCampaignId);
  const clearDropFocus = useMobileNavStore((s) => s.clearDropFocus);
  const campaignRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [flashedCampaign, setFlashedCampaign] = useState<string | null>(null);
  // Tapping a campaign opens every reward in it, the way the desktop Drops
  // Center does. The card alone only says "2/5", which tells you nothing about
  // WHAT the remaining three are.
  const [campaignDetail, setCampaignDetail] = useState<InventoryItem | null>(null);
  const [globalBadges, setGlobalBadges] = useState<GlobalBadge[]>([]);
  const [ownedTitles, setOwnedTitles] = useState<Set<string>>(new Set());
  const [badgesLoading, setBadgesLoading] = useState(false);
  const [badgeSort, setBadgeSort] = useState<BadgeSort>('newest');
  const [badgeDetail, setBadgeDetail] = useState<GlobalBadge | null>(null);
  const [metaProgress, setMetaProgress] = useState(0);
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

  // Consume a pending focus once the campaign has actually rendered. Runs off
  // `inventory` too because the tap usually lands before the list has loaded,
  // and scrolling to an element that does not exist yet does nothing.
  useEffect(() => {
    if (!focusDropCampaignId) return;
    if (tab !== 'drops') setTab('drops');
    const el = campaignRefs.current[focusDropCampaignId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashedCampaign(focusDropCampaignId);
    clearDropFocus();
    const t = setTimeout(() => setFlashedCampaign(null), 1800);
    return () => clearTimeout(t);
  }, [focusDropCampaignId, inventory, tab, clearDropFocus]);

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

      const build = (metaMap: Record<string, CachedBadgeMeta>): GlobalBadge[] => {
        const seen = new Set<string>();
        const out: GlobalBadge[] = [];
        for (const set of global?.data ?? []) {
          for (const v of set.versions ?? []) {
            const image = v.image_url_4x || v.image_url_2x;
            if (!v.title || !image || !set.set_id || !v.id) continue;
            if (seen.has(v.title)) continue; // same badge repeats across sets
            seen.add(v.title);
            const cached = metaMap[`metadata:${set.set_id}-v${v.id}`];
            out.push({
              key: `${set.set_id}-${v.id}`,
              setId: set.set_id,
              versionId: v.id,
              title: v.title,
              description: v.description ?? '',
              image,
              position:
                typeof cached?.position === 'number' ? cached.position : Number.MAX_SAFE_INTEGER,
              addedMs: parseAdded(cached?.data?.date_added),
              usage: parseUsage(cached?.data?.usage_stats),
              status: deriveBadgeStatus(cached?.data?.more_info, cached?.data?.enrichment),
              dateInfo: formatBadgeDateInfo(cached?.data?.more_info),
              moreInfo: cached?.data?.more_info ?? '',
              infoUrl: cached?.data?.info_url ?? '',
            });
          }
        }
        return out;
      };

      setGlobalBadges(build(meta));

      const uid = currentUser?.user_id;
      const login = currentUser?.login || currentUser?.username;
      if (uid && login) {
        const mine = await getAllUserBadgesWithEarned(uid, login, uid, login);
        setOwnedTitles(new Set((mine.earnedBadges ?? []).map((b) => b.title)));
      }
      setBadgesLoading(false);

      // Mobile had never populated the badge metadata cache, which is why the
      // gallery had almost no dates or earn windows to sort by. Fetch what is
      // missing in batches (same commands the desktop gallery uses), then
      // rebuild from the refreshed cache.
      try {
        const missing = await invoke<[string, string][]>('get_badges_missing_metadata');
        if (missing.length > 0) {
          setMetaProgress(missing.length);
          const batchSize = 5;
          for (let i = 0; i < missing.length; i += batchSize) {
            await Promise.allSettled(
              missing.slice(i, i + batchSize).map(([setId, version]) =>
                invoke('fetch_badge_metadata', { badgeSetId: setId, badgeVersion: version }),
              ),
            );
            setMetaProgress(Math.max(0, missing.length - (i + batchSize)));
          }
          const refreshed =
            (await invoke<Record<string, CachedBadgeMeta>>('get_all_universal_cached_items', {
              cacheType: 'badge',
            })) ?? {};
          setGlobalBadges(build(refreshed));
        }
      } catch (err) {
        Logger.warn('[Activity] badge metadata backfill failed:', err);
      } finally {
        setMetaProgress(0);
      }
      return;
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

  // Same ordering rules as the desktop gallery: prefer the precomputed
  // positions when the cache has them broadly, otherwise fall back to
  // date_added, with a stable key as the final tiebreak.
  const sortedBadges = useMemo(() => {
    const withPos = globalBadges.filter((b) => b.position !== Number.MAX_SAFE_INTEGER).length;
    const usePositions = withPos >= globalBadges.length * 0.9 && globalBadges.length > 0;
    const byNewest = (a: GlobalBadge, b: GlobalBadge) =>
      (usePositions ? a.position - b.position : b.addedMs - a.addedMs) || a.key.localeCompare(b.key);

    return [...globalBadges].sort((a, b) => {
      switch (badgeSort) {
        case 'oldest':
          return (
            (usePositions ? b.position - a.position : a.addedMs - b.addedMs) ||
            a.key.localeCompare(b.key)
          );
        case 'available': {
          const rank = (x: GlobalBadge) => (x.status === 'available' ? 1 : 0);
          return rank(b) - rank(a) || byNewest(a, b);
        }
        case 'soon': {
          const rank = (x: GlobalBadge) => (x.status === 'coming-soon' ? 1 : 0);
          return rank(b) - rank(a) || byNewest(a, b);
        }
        case 'usage':
          return b.usage - a.usage || byNewest(a, b);
        default:
          return byNewest(a, b);
      }
    });
  }, [globalBadges, badgeSort]);

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
                {metaProgress > 0 && (
                  <span className="ml-auto text-[11.5px] text-textMuted">
                    {metaProgress} to sync
                  </span>
                )}
              </div>
              {/* Sort options, mirroring the desktop gallery's set. */}
              <div className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1">
                {BADGE_SORTS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setBadgeSort(s.id)}
                    className={`shrink-0 px-3 py-1 rounded-full text-[12.5px] transition-colors ${
                      badgeSort === s.id
                        ? 'glass-button-static text-textPrimary font-semibold'
                        : 'text-textMuted'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
                {sortedBadges.map((badge) => {
                  const owned = ownedTitles.has(badge.title);
                  const available = badge.status === 'available';
                  const comingSoon = badge.status === 'coming-soon';
                  return (
                    <button
                      key={badge.key}
                      onClick={() => setBadgeDetail(badge)}
                      className={`glass-panel p-2 flex flex-col items-center gap-1.5 relative active:opacity-80 ${
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
                    </button>
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
                    <div
                      key={item.campaign.id}
                      ref={(el) => {
                        campaignRefs.current[item.campaign.id] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setCampaignDetail(item)}
                      className={`glass-panel p-2.5 flex gap-2.5 transition-shadow duration-500 active:opacity-80 ${
                        flashedCampaign === item.campaign.id ? 'ring-2 ring-accent' : ''
                      }`}
                    >
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

      {/* Badge detail: art, status, when it was added, how it is earned. */}
      <MobileSheet
        open={!!badgeDetail}
        onClose={() => setBadgeDetail(null)}
        maxHeightFraction={0.66}
      >
        {badgeDetail && (
          <div className="flex flex-col items-center text-center pb-1">
            <img
              src={badgeDetail.image}
              alt=""
              className="w-20 h-20 object-contain mb-2.5"
              draggable={false}
            />
            <div className="text-[16px] font-semibold text-textPrimary">{badgeDetail.title}</div>
            <div className="mt-1 mb-2.5">
              {ownedTitles.has(badgeDetail.title) ? (
                <span className="text-[11px] font-semibold text-accent">OWNED</span>
              ) : badgeDetail.status === 'available' ? (
                <span className="text-[11px] font-semibold text-success">AVAILABLE NOW</span>
              ) : badgeDetail.status === 'coming-soon' ? (
                <span className="text-[11px] font-semibold text-warning">COMING SOON</span>
              ) : badgeDetail.status === 'expired' ? (
                <span className="text-[11px] font-semibold text-textMuted">NO LONGER EARNABLE</span>
              ) : null}
            </div>
            {/* ONE body, split into parts. `dateInfo` is the full more_info
                blurb with its dates localized (not a short date label), so it
                is the source for all three pieces below. */}
            {(() => {
              const { prose, window, caveat } = splitBadgeBlurb(
                badgeDetail.dateInfo || badgeDetail.description,
              );
              return (
                <>
                  {prose && (
                    <p className="text-[13px] text-textSecondary leading-relaxed whitespace-pre-line text-left w-full">
                      {prose}
                    </p>
                  )}
                  {caveat && (
                    <div className="mt-3 w-full flex items-start gap-2 rounded-lg px-3 py-2 bg-amber-500/10 border border-amber-500/25">
                      <Warning size={14} weight="fill" className="text-amber-400 shrink-0 mt-px" />
                      <span className="text-[12.5px] text-amber-300/90 leading-snug text-left">
                        {caveat}
                      </span>
                    </div>
                  )}
                  {window && (
                    <div className="mt-3 w-full glass-tile rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                      <CalendarBlank size={16} className="text-accent shrink-0" />
                      <div className="min-w-0 text-left">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-textMuted leading-none mb-1">
                          Event duration
                        </div>
                        <div className="text-[12.5px] text-textPrimary leading-snug">{window}</div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
            {badgeDetail.usage > 0 && (
              <p className="text-[12px] text-textMuted mt-3 self-center">
                {badgeDetail.usage.toLocaleString()} users have this badge
              </p>
            )}
            {badgeDetail.infoUrl && (
              <button
                onClick={() => {
                  void invoke('open_browser_url', { url: badgeDetail.infoUrl }).catch(() => {});
                }}
                className="glass-button sn-touch mt-4 w-full text-[13.5px] font-semibold text-textPrimary"
              >
                More info
              </button>
            )}
          </div>
        )}
      </MobileSheet>

      {/* Every reward in one campaign, in the order you earn them. */}
      <MobileSheet
        open={!!campaignDetail}
        onClose={() => setCampaignDetail(null)}
        title={campaignDetail?.campaign.name}
        maxHeightFraction={0.8}
      >
        {campaignDetail && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[12.5px] text-textMuted">
              {campaignDetail.campaign.game_name && (
                <span className="truncate">{campaignDetail.campaign.game_name}</span>
              )}
              <span className="ml-auto shrink-0">
                {campaignDetail.claimed_drops}/{campaignDetail.total_drops} claimed
              </span>
            </div>

            {[...(campaignDetail.campaign.time_based_drops || [])]
              .sort((a, b) => a.required_minutes_watched - b.required_minutes_watched)
              .map((drop) => {
                const need = drop.required_minutes_watched;
                const have = Math.min(drop.progress?.current_minutes_watched ?? 0, need);
                const claimed = !!drop.progress?.is_claimed;
                const done = claimed || (need > 0 && have >= need);
                const pct = need > 0 ? Math.min(100, (have / need) * 100) : 0;
                const benefit = drop.benefit_edges?.[0];
                return (
                  <div key={drop.id} className="flex items-center gap-2.5 py-1">
                    {benefit?.image_url ? (
                      <img
                        src={benefit.image_url}
                        alt=""
                        draggable={false}
                        className={`w-10 h-10 rounded-md object-cover shrink-0 ring-1 ring-white/10 ${
                          claimed ? '' : 'opacity-90'
                        }`}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-surface flex items-center justify-center shrink-0">
                        <Gift size={16} className="text-textMuted" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] text-textPrimary truncate">
                          {benefit?.name || drop.name}
                        </span>
                        <span
                          className={`ml-auto text-[11px] shrink-0 tabular-nums ${
                            claimed
                              ? 'text-success'
                              : done
                                ? 'text-success font-semibold'
                                : 'text-textMuted'
                          }`}
                        >
                          {claimed ? 'Claimed' : done ? 'Ready' : `${need - have}m left`}
                        </span>
                      </div>
                      {/* A 0-minute drop is event or action based, not something
                          watch time earns, so it gets no bar to imply otherwise. */}
                      {need > 0 && (
                        <div className="h-1 rounded-full bg-surface overflow-hidden mt-1.5">
                          <div
                            className={`h-full rounded-full ${
                              done ? 'bg-success' : 'bg-accent'
                            }`}
                            style={{ width: `${claimed ? 100 : pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </MobileSheet>
    </div>
  );
};
