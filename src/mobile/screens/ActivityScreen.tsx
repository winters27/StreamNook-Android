// Activity: drops progress and rewards. Uses the same backend surface as the
// desktop Drops Center; connecting uses the device-code flow directly (the
// desktop's authorize popup is desktop-gated), showing the code here and
// opening the browser, mirroring the main Twitch login pattern on mobile.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowSquareOut, CheckCircle, Gift } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { PullToRefresh } from '../ui/PullToRefresh';
import { Logger } from '../../utils/logger';
import type { DropsDeviceCodeInfo, InventoryItem, InventoryResponse } from '../../types';

export const ActivityScreen: React.FC = () => {
  const addToast = useAppStore((s) => s.addToast);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [deviceCode, setDeviceCode] = useState<DropsDeviceCodeInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const connect = async () => {
    setConnecting(true);
    try {
      const info = await invoke<DropsDeviceCodeInfo>('start_drops_device_flow');
      setDeviceCode(info);
      void invoke('open_browser_url', { url: info.verification_uri }).catch(() => {});
      await invoke('poll_drops_token', {
        deviceCode: info.device_code,
        interval: info.interval,
        expiresIn: info.expires_in,
      });
      setDeviceCode(null);
      addToast('Drops connected!', 'success');
      await load();
    } catch (err) {
      Logger.error('[Activity] drops connect failed:', err);
      addToast('Drops connection failed. Try again.', 'error');
      setDeviceCode(null);
    } finally {
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

  const inProgress = (inventory?.items ?? []).filter(
    (i: InventoryItem) => i.status === 'Active' || i.drops_in_progress > 0,
  );
  const completed = inventory?.completed_drops ?? [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <h1 className="text-xl font-bold text-textPrimary">Activity</h1>
      </div>
      <PullToRefresh onRefresh={load}>
        <div className="px-4 sn-tabbar-clearance">
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
                    {copied ? 'Copied' : 'Tap the code to copy, then authorize in the browser.'}
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-[12.5px] text-textMuted mt-2">
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                    Waiting for authorization…
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => void connect()}
                  disabled={connecting}
                  className="glass-button sn-touch w-full text-[14px] font-semibold text-textPrimary disabled:opacity-60 flex items-center justify-center gap-1.5"
                >
                  Connect drops
                  <ArrowSquareOut size={15} />
                </button>
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
                    <div key={item.campaign.id} className="glass-panel p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[14px] font-medium text-textPrimary truncate">
                          {item.campaign.name}
                        </span>
                        <span className="text-[12px] text-textMuted shrink-0">
                          {item.claimed_drops}/{item.total_drops}
                        </span>
                      </div>
                      {item.campaign.game_name && (
                        <div className="text-[12px] text-textMuted truncate mb-1.5">
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
