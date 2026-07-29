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

// Inventory is a network round trip, and drop minutes tick once a minute at
// best, so this is deliberately slow.
const POLL_MS = 120_000;

interface Shown {
  dropId: string;
  /** Twitch wants this alongside the drop id to claim; absent on some entries. */
  dropInstanceId?: string;
  name: string;
  image?: string;
  current: number;
  required: number;
}

export const DropProgressBar: React.FC = () => {
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

      // Only campaigns that this stream can actually advance. Watching Rust
      // does not earn a Fortnite drop, and showing one would imply it does.
      // Category is the primary test; an ACL campaign that explicitly lists
      // this channel counts too, since those earn regardless of how the
      // category string happens to be spelled.
      const target = gameName.toLowerCase();
      const login = (channelLogin || '').toLowerCase();
      const relevant = inv.items.filter((it) => {
        if (target && (it.campaign.game_name || '').toLowerCase() === target) return true;
        if (!login) return false;
        return (it.campaign.allowed_channels || []).some(
          (c) => (c.name || '').toLowerCase() === login,
        );
      });
      const drops: TimeBasedDrop[] = relevant.flatMap((it) => it.campaign.time_based_drops || []);
      Logger.debug(
        `[DropProgress] game="${gameName}" channel="${login}" campaigns=${inv.items.length} relevant=${relevant.length} drops=${drops.length}`,
      );

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
        Logger.debug('[DropProgress] no unclaimed collectible tier for this stream');
        setShown(null);
        return;
      }
      candidates.sort((a, b) => a.required - a.current - (b.required - b.current));
      const best = candidates[0];
      setShown({
        dropId: best.d.id,
        dropInstanceId: best.d.progress?.drop_instance_id,
        name: best.d.benefit_edges?.[0]?.name || best.d.name || 'Drop',
        image: best.d.benefit_edges?.[0]?.image_url,
        current: best.current,
        required: best.required,
      });
    } catch (err) {
      Logger.warn('[DropProgress] inventory read failed:', err);
    }
  }, [gameName, channelLogin]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (!shown) return null;

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
    <div className="pointer-events-auto flex items-center gap-2 mt-1">
      {shown.image ? (
        <img
          src={shown.image}
          alt=""
          className="w-6 h-6 rounded object-cover shrink-0"
          draggable={false}
        />
      ) : (
        <Gift size={16} className="text-accent shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-textSecondary truncate">{shown.name}</span>
          <span className="ml-auto text-[11px] text-textMuted shrink-0 tabular-nums">
            {complete ? 'Ready' : `${remaining}m left`}
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
