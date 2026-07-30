// Live drop progress for the stream you are watching.
//
// Where the numbers come from, because it is not the obvious place: the live
// `drop-progress` / `drops-progress-update` events are emitted by the desktop
// automation controller (a plugin component), not by Rust, so on mobile they
// never fire. `get_drop_progress` is not the answer either — it returns a
// zero-filled entry per drop in this build, which would render a bar stuck at
// 0%. The real accrued minutes ride along on each inventory drop's own embedded
// `progress`, which is what the desktop controller prefers for the same reason.
//
// So this polls the inventory and matches it to the category being watched.
import React, { useCallback, useEffect, useState } from 'react';
import { Gift } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { Logger } from '../../utils/logger';
import type { InventoryResponse, TimeBasedDrop } from '../../types';

// Inventory is a network round trip. While we have nothing to show we are
// waiting for the campaign to appear at all, so check often; once tracking, back
// off because accrued minutes only move once a minute.
const POLL_SEARCHING_MS = 20_000;
const POLL_TRACKING_MS = 60_000;

interface Shown {
  dropId: string;
  /** Twitch wants this alongside the drop id to claim; absent on some entries. */
  dropInstanceId?: string;
  name: string;
  image?: string;
  /** Campaign this reward belongs to, e.g. "Ignite Stage 1 PlayOffs". */
  campaign: string | null;
  /** 1-based tier position and total, e.g. 2 of 5. */
  tierIndex: number | null;
  tierCount: number | null;
  current: number;
  required: number;
}

interface Props {
  /** Lets the chat header know whether it has anything to show. The header is
   *  otherwise gated on hype train / pinned message and would never mount this. */
  onActiveChange?: (active: boolean) => void;
  /** False while a different chat tab is on screen. Progress belongs to the
   *  stream, not to whatever room you are reading, so it hides — but stays
   *  mounted so the poll keeps running and is current when you switch back. */
  visible?: boolean;
}

export const DropProgressBar: React.FC<Props> = ({ onActiveChange, visible = true }) => {
  const currentStream = useAppStore((s) => s.currentStream);
  const originCategory = useAppStore((s) => s.streamOriginCategory);
  const addToast = useAppStore((s) => s.addToast);
  const [shown, setShown] = useState<Shown | null>(null);
  const [claiming, setClaiming] = useState(false);

  // `currentStream.game_name` is '' whenever startStream fell back to the
  // channel-info path, so the category the stream was opened from is a real
  // second source rather than a nicety.
  const gameName = currentStream?.game_name || originCategory?.name || '';
  const channelLogin = currentStream?.user_login;

  const refresh = useCallback(async () => {
    if (!gameName && !channelLogin) {
      setShown(null);
      return;
    }
    try {
      const connected = await invoke<boolean>('is_drops_authenticated').catch(() => false);
      if (!connected) {
        setShown(null);
        return;
      }
      const inv = await invoke<InventoryResponse>('get_drops_inventory').catch(() => null);
      if (!inv) return;

      // Only campaigns that this stream can actually advance. Watching Rust does
      // not earn a Fortnite drop, and showing one would imply it does.
      //
      // CATEGORY IS THE RULE, not a hint: Twitch credits watch-time against a
      // campaign only while the channel is streaming that campaign's game, and
      // that holds for ACL campaigns too. An earlier version treated "this
      // channel is in the campaign's allow-list" as sufficient on its own, which
      // showed a Marvel Rivals drop progressing while the channel played
      // something else entirely. The allow-list is now only consulted when the
      // category is genuinely unknown.
      const target = gameName.toLowerCase();
      const login = (channelLogin || '').toLowerCase();
      const relevant = inv.items.filter((it) => {
        if (target) return (it.campaign.game_name || '').toLowerCase() === target;
        if (!login) return false;
        return (it.campaign.allowed_channels || []).some(
          (c) => (c.name || '').toLowerCase() === login,
        );
      });
      const drops: TimeBasedDrop[] = relevant.flatMap((it) => it.campaign.time_based_drops || []);
      // Warn, not debug: debug is silenced by default, and a stream that Twitch
      // flags as drops-enabled but that we cannot match to a campaign is the one
      // case worth seeing in logcat without a devtools session.
      if (relevant.length === 0 || drops.length === 0) {
        Logger.warn(
          `[DropProgress] no match: game="${gameName}" channel="${login}" campaigns=${inv.items.length} relevant=${relevant.length} drops=${drops.length}`,
        );
      }

      // The tier being earned right now is the unclaimed collectible one with
      // the fewest minutes left, matching the backend's own choice rule.
      const candidates = drops
        .filter((d) => d.required_minutes_watched > 0 && !d.progress?.is_claimed)
        .map((d) => ({
          d,
          current: Math.min(d.progress?.current_minutes_watched ?? 0, d.required_minutes_watched),
          required: d.required_minutes_watched,
        }))
        .filter((c) => c.current < c.required);

      if (candidates.length === 0) {
        Logger.warn(
          `[DropProgress] matched ${drops.length} drop(s) but none collectible+unclaimed+incomplete`,
        );
        setShown(null);
        return;
      }
      candidates.sort((a, b) => a.required - a.current - (b.required - b.current));
      const best = candidates[0];

      // Which tier of its campaign this is. Campaigns ship several rewards at
      // increasing watch times, and "2 of 5" tells you far more about how far
      // through you are than the single bar does.
      const owner = relevant.find((it) =>
        (it.campaign.time_based_drops || []).some((d) => d.id === best.d.id),
      );
      const tiers = [...(owner?.campaign.time_based_drops || [])]
        .filter((d) => d.required_minutes_watched > 0)
        .sort((a, b) => a.required_minutes_watched - b.required_minutes_watched);
      const tierIndex = tiers.findIndex((d) => d.id === best.d.id);

      setShown({
        dropId: best.d.id,
        dropInstanceId: best.d.progress?.drop_instance_id,
        name: best.d.benefit_edges?.[0]?.name || best.d.name || 'Drop',
        image: best.d.benefit_edges?.[0]?.image_url,
        campaign: owner?.campaign.name ?? null,
        tierIndex: tierIndex >= 0 ? tierIndex + 1 : null,
        tierCount: tiers.length || null,
        current: best.current,
        required: best.required,
      });
    } catch (err) {
      Logger.warn('[DropProgress] inventory read failed:', err);
    }
  }, [gameName, channelLogin]);

  // Adaptive interval, and this is the fix for "it never appears until I leave
  // and come back". A campaign only enters the inventory ONCE YOU HAVE PROGRESS,
  // so at the moment you start watching there is genuinely nothing to find. On a
  // flat two-minute poll that meant up to three minutes of blank before the bar
  // showed, while rejoining remounted the component and refreshed instantly —
  // which is exactly the behaviour that looked like a bug.
  //
  // So: hunt quickly while there is nothing to show, then back off once we are
  // tracking something, since accrued minutes only tick once a minute anyway.
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), shown ? POLL_TRACKING_MS : POLL_SEARCHING_MS);
    return () => clearInterval(t);
  }, [refresh, shown]);

  useEffect(() => {
    // Report inactive while hidden too, so the header does not reserve space for
    // a bar that is not being drawn.
    onActiveChange?.(visible && !!shown);
    return () => onActiveChange?.(false);
  }, [shown, visible, onActiveChange]);

  if (!shown || !visible) return null;

  const pct = Math.min(100, (shown.current / shown.required) * 100);
  const complete = shown.current >= shown.required;
  const remaining = Math.max(0, shown.required - shown.current);

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await invoke('claim_drop', {
        dropId: shown.dropId,
        dropInstanceId: shown.dropInstanceId ?? null,
      });
      addToast('Drop claimed', 'success');
      await refresh();
    } catch (err) {
      Logger.error('[DropProgress] claim failed:', err);
      addToast('Could not claim that drop.', 'error');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="pointer-events-auto flex items-center gap-2.5 mt-1">
      {shown.image ? (
        <img
          src={shown.image}
          alt=""
          className="w-9 h-9 rounded-md object-cover shrink-0 ring-1 ring-white/10"
          draggable={false}
        />
      ) : (
        <div className="w-9 h-9 rounded-md bg-surface flex items-center justify-center shrink-0">
          <Gift size={16} className="text-accent" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {/* Line 1: what you are earning, and how long is left. */}
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold text-textPrimary truncate">{shown.name}</span>
          <span
            className={`ml-auto text-[11px] shrink-0 tabular-nums ${
              complete ? 'text-success font-semibold' : 'text-textMuted'
            }`}
          >
            {complete ? 'Ready to claim' : `${remaining}m left`}
          </span>
        </div>
        {/* Line 2: which campaign, which tier, and the exact minutes. The bar
            alone says roughly-how-far; this says where you actually are. */}
        <div className="flex items-baseline gap-1.5 text-[10.5px] text-textMuted">
          {shown.campaign && <span className="truncate min-w-0">{shown.campaign}</span>}
          {shown.tierIndex && shown.tierCount && shown.tierCount > 1 && (
            <span className="shrink-0">
              {shown.campaign ? '· ' : ''}
              {shown.tierIndex} of {shown.tierCount}
            </span>
          )}
          <span className="ml-auto shrink-0 tabular-nums">
            {shown.current}/{shown.required}m
          </span>
        </div>
        <div className="h-1 rounded-full bg-surface overflow-hidden mt-1">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${
              complete ? 'bg-success' : 'bg-accent'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {complete && (
        <button
          onClick={() => void claim()}
          disabled={claiming}
          className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-success/20 text-success disabled:opacity-60"
        >
          {claiming ? '…' : 'Claim'}
        </button>
      )}
    </div>
  );
};
