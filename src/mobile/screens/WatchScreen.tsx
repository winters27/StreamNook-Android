// The watch layer.
//
// Portrait: 16:9 player band + the desktop-identity chat header (blurred
// overlay with stream info, pinned strip, HypeTrainBanner) + chat, with the
// poll and prediction cards mounted over the chat like desktop.
// Landscape: immersive full-bleed player (system bars hidden via the native
// bridge) with a chat side panel toggle.
// TRUE system PiP: drag the player down, tap the player's PiP control, or
// leave the app while playing; the OS window is draggable/resizable and the
// shell strips to the bare player (sn:pip event from MainActivity).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, PushPin } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import { usePinStore } from '../../stores/pinStore';
import { useOrientation } from '../ui/useOrientation';
import { MobilePlayer } from '../player/MobilePlayer';
import { MobileChatPane } from '../chat/MobileChatPane';
import { MobileSheet } from '../ui/MobileSheet';
import HypeTrainBanner from '../../components/HypeTrainBanner';
import PollOverlay from '../../components/PollOverlay';
import PredictionOverlay from '../../components/PredictionOverlay';
import LoadingWidget from '../../components/LoadingWidget';
import { enterPip, setImmersive, setKeepScreenOn, setPipEligible } from '../nativeBridge';
import { Logger } from '../../utils/logger';

// "2h 14m" from the Helix started_at timestamp, ticking once a minute.
function formatUptime(startedAt: string, nowMs: number): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return '';
  const totalSec = Math.max(0, Math.floor((nowMs - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface PinnedMessage {
  id: string;
  message_id: string;
  message_text: string;
  sender_name: string;
  sender_color: string;
}

const MINI_DRAG_THRESHOLD_PX = 70;

export const WatchScreen: React.FC = () => {
  const isLoading = useAppStore((s) => s.isLoading);
  const streamUrl = useAppStore((s) => s.streamUrl);
  const currentStream = useAppStore((s) => s.currentStream);
  const currentHypeTrain = useAppStore((s) => s.currentHypeTrain);
  const refreshNonce = usePinStore((s) => s.refreshNonce);
  const orientation = useOrientation();
  const [landscapeChat, setLandscapeChat] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pip, setPip] = useState(false);
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const watching = !!streamUrl && streamUrl !== 'offline';
  const channelId = currentStream?.user_id;

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // System PiP strip-down flag from MainActivity.
  useEffect(() => {
    const onPip = (e: Event) => setPip(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener('sn:pip', onPip);
    return () => window.removeEventListener('sn:pip', onPip);
  }, []);

  // Native playback affordances: stay awake + PiP eligibility while playing,
  // immersive bars only for full landscape playback.
  useEffect(() => {
    setKeepScreenOn(watching);
    setPipEligible(watching);
    return () => {
      setKeepScreenOn(false);
      setPipEligible(false);
    };
  }, [watching]);

  useEffect(() => {
    const immersive = watching && orientation === 'landscape' && !pip;
    setImmersive(immersive);
    return () => setImmersive(false);
  }, [watching, orientation, pip]);

  // Pinned messages: 30s poll + instant refresh on pin/unpin actions.
  useEffect(() => {
    if (!channelId || !watching) {
      // External-store sync: clearing stale pins when the channel goes away.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPinned([]);
      return;
    }
    let cancelled = false;
    const fetchPins = async () => {
      try {
        const messages = await invoke<PinnedMessage[]>('get_pinned_chat_messages', {
          channelId,
        });
        if (!cancelled) {
          setPinned(messages || []);
          usePinStore.getState().setPinnedIds(
            (messages || []).map((m) => m.message_id).filter(Boolean),
          );
        }
      } catch (err) {
        Logger.warn('[Watch] pinned fetch failed:', err);
      }
    };
    void fetchPins();
    const t = setInterval(() => void fetchPins(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [channelId, watching, refreshNonce]);

  // Drag the portrait player downward to enter TRUE system PiP.
  const onPlayerTouchStart = useCallback((e: React.TouchEvent) => {
    dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);
  const onPlayerTouchMove = useCallback((e: React.TouchEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const dy = e.touches[0].clientY - start.y;
    const dx = Math.abs(e.touches[0].clientX - start.x);
    if (dy > MINI_DRAG_THRESHOLD_PX && dy > dx * 1.5) {
      dragStart.current = null;
      enterPip();
    }
  }, []);
  const onPlayerTouchEnd = useCallback(() => {
    dragStart.current = null;
  }, []);

  if (!streamUrl && !isLoading) return null;

  if (isLoading && !streamUrl) {
    return (
      <div className="absolute inset-0 z-40 bg-background flex items-center justify-center">
        <LoadingWidget fullScreen={false} useFunnyMessages={true} />
      </div>
    );
  }

  // System PiP: the OS window is tiny; show the bare player only.
  if (pip) {
    return (
      <div className="absolute inset-0 z-50 bg-black">
        <MobilePlayer immersive />
      </div>
    );
  }

  if (orientation === 'landscape') {
    return (
      <div className="absolute inset-0 z-40 bg-black flex">
        <div className="flex-1 min-w-0">
          <MobilePlayer immersive onToggleFullscreen={() => setLandscapeChat((v) => !v)} />
        </div>
        {landscapeChat && (
          <div className="w-[320px] shrink-0 bg-background flex flex-col relative">
            {currentStream && (
              <>
                <PredictionOverlay
                  channelId={currentStream.user_id}
                  channelLogin={currentStream.user_login}
                  isHypeTrainActive={!!currentHypeTrain}
                />
                <PollOverlay
                  channelId={currentStream.user_id}
                  channelLogin={currentStream.user_login}
                  isHypeTrainActive={!!currentHypeTrain}
                />
              </>
            )}
            <MobileChatPane />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-40 bg-background flex flex-col"
      style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
    >
      {/* Drag the player band down to hand playback to the OS PiP window. */}
      <div
        className="w-full aspect-video relative shrink-0"
        onTouchStart={onPlayerTouchStart}
        onTouchMove={onPlayerTouchMove}
        onTouchEnd={onPlayerTouchEnd}
      >
        <MobilePlayer onEnterPip={enterPip} />
      </div>

      {(
        <div className="flex-1 min-h-0 relative flex flex-col">
          {currentStream && (
            <div
              className="absolute top-0 left-0 right-0 px-3.5 py-2 border-b border-borderSubtle backdrop-blur-ultra z-10 pointer-events-none shadow-lg overflow-hidden flex flex-col-reverse"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-background) 90%, transparent)',
              }}
            >
              {currentHypeTrain && (
                <HypeTrainBanner
                  train={currentHypeTrain}
                  onExpire={() => useAppStore.getState().setCurrentHypeTrain(null)}
                />
              )}
              {pinned.length > 0 && (
                <button
                  onClick={() => setPinsOpen(true)}
                  className="pointer-events-auto flex items-center gap-1.5 mt-1 text-left"
                >
                  <PushPin size={12} weight="fill" className="text-accent shrink-0" />
                  <span className="text-[12px] text-textSecondary truncate">
                    <span
                      className="font-semibold"
                      style={{ color: pinned[0].sender_color || undefined }}
                    >
                      {pinned[0].sender_name}
                    </span>
                    : {pinned[0].message_text}
                  </span>
                </button>
              )}
              <div className="relative z-10">
                <div className="text-[13.5px] font-semibold text-textPrimary truncate leading-snug">
                  {currentStream.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5 min-w-0">
                  <span className="text-[12.5px] text-textSecondary truncate">
                    {currentStream.user_name}
                    {currentStream.game_name ? ` · ${currentStream.game_name}` : ''}
                  </span>
                  <span className="ml-auto flex items-center gap-2 shrink-0 text-[12px] text-textMuted">
                    <span className="flex items-center gap-1 text-live">
                      <Eye size={13} weight="fill" />
                      {currentStream.viewer_count.toLocaleString()}
                    </span>
                    {currentStream.started_at && (
                      <span>{formatUptime(currentStream.started_at, nowMs)}</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Poll + prediction cards, exactly the desktop components: they
              self-fetch off the channel and anchor under the header. */}
          {currentStream && (
            <>
              <PredictionOverlay
                channelId={currentStream.user_id}
                channelLogin={currentStream.user_login}
                isHypeTrainActive={!!currentHypeTrain}
              />
              <PollOverlay
                channelId={currentStream.user_id}
                channelLogin={currentStream.user_login}
                isHypeTrainActive={!!currentHypeTrain}
              />
            </>
          )}

          <MobileChatPane />
        </div>
      )}

      {/* Pinned messages, expanded. */}
      <MobileSheet open={pinsOpen} onClose={() => setPinsOpen(false)} title="Pinned">
        <div className="flex flex-col gap-3">
          {pinned.map((pin) => (
            <div key={pin.id} className="text-[14px] leading-relaxed">
              <span
                className="font-semibold"
                style={{ color: pin.sender_color || undefined }}
              >
                {pin.sender_name}
              </span>
              <span className="text-textPrimary">: {pin.message_text}</span>
            </div>
          ))}
        </div>
      </MobileSheet>
    </div>
  );
};
