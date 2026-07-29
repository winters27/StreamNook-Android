// Live drop progress for the stream you are watching.
//
// The Rust watch heartbeat credits minutes while the player reports playing;
// this reads back the resulting per-drop progress so the earn is visible
// instead of silent. Sits in the chat header stack, above the pinned strip.
import React, { useCallback, useEffect, useState } from 'react';
import { Gift } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../stores/AppStore';
import { Logger } from '../../utils/logger';
import type { DropProgress } from '../../types';

const POLL_MS = 30_000;

export const DropProgressBar: React.FC = () => {
  const addToast = useAppStore((s) => s.addToast);
  const [drop, setDrop] = useState<DropProgress | null>(null);
  const [claiming, setClaiming] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const all = await invoke<DropProgress[]>('get_drop_progress');
      // The campaign actively being watched: unclaimed, with a real
      // requirement. Furthest along wins when a campaign has several drops.
      const active = (all ?? [])
        .filter((d) => !d.is_claimed && d.required_minutes_watched > 0)
        .sort((a, b) => b.current_minutes_watched - a.current_minutes_watched)[0];
      setDrop(active ?? null);
    } catch (err) {
      Logger.warn('[DropProgress] read failed:', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    // The backend announces progress ticks; refresh promptly on those rather
    // than waiting out the poll.
    const un = listen('drop-progress', () => void refresh());
    return () => {
      clearInterval(t);
      void un.then((f) => f());
    };
  }, [refresh]);

  if (!drop) return null;

  const current = Math.min(drop.current_minutes_watched, drop.required_minutes_watched);
  const pct = Math.min(100, (current / drop.required_minutes_watched) * 100);
  const complete = current >= drop.required_minutes_watched;

  const claim = async () => {
    if (!drop.drop_instance_id || claiming) return;
    setClaiming(true);
    try {
      await invoke('claim_drop', {
        dropId: drop.drop_id,
        dropInstanceId: drop.drop_instance_id,
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
      {drop.drop_image ? (
        <img
          src={drop.drop_image}
          alt=""
          className="w-6 h-6 rounded object-cover shrink-0"
          draggable={false}
        />
      ) : (
        <Gift size={14} className="text-accent shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-textSecondary truncate">
            {drop.drop_name || 'Drop progress'}
          </span>
          <span className="ml-auto text-[11px] text-textMuted shrink-0 tabular-nums">
            {current}/{drop.required_minutes_watched}m
          </span>
        </div>
        <div className="h-1 rounded-full bg-surface overflow-hidden mt-1">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              complete ? 'bg-success' : 'bg-accent'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {complete && drop.drop_instance_id && (
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
