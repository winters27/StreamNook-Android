// The watch layer.
//
// Portrait full: 16:9 player band + the desktop-identity chat header (blurred
// overlay with stream info, pinned strip, HypeTrainBanner) + chat, with the
// poll and prediction cards mounted over the chat like desktop.
// Mini: drag the player down (or press back) and the whole layer ANIMATES into
// a small floating window you can drag anywhere; it snaps to the nearest edge
// and the tab shell stays live behind it, so browsing continues with the
// stream playing. Tap to expand, X to close.
// Landscape: immersive full-bleed player (system bars hidden) + chat toggle.
// System PiP: the PiP control or leaving the app hands the whole activity to
// the OS window (draggable/resizable by the system, floats over every app).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PushPin, X } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import { usePinStore } from '../../stores/pinStore';
import { useOrientation } from '../ui/useOrientation';
import { MobilePlayer } from '../player/MobilePlayer';
import { MobileChatPane } from '../chat/MobileChatPane';
import { CHAT_TAB_STRIP_H, useChatTabsVisible } from '../chat/ChatTabStrip';
import { MobileSheet } from '../ui/MobileSheet';
import { DropProgressBar } from '../watch/DropProgressBar';
import HypeTrainBanner from '../../components/HypeTrainBanner';
import PollOverlay from '../../components/PollOverlay';
import PredictionOverlay from '../../components/PredictionOverlay';
import LoadingWidget from '../../components/LoadingWidget';
import { enterPip, setImmersive, setKeepScreenOn, setPipEligible } from '../nativeBridge';
import { Logger } from '../../utils/logger';

interface PinnedMessage {
  id: string;
  message_id: string;
  message_text: string;
  sender_name: string;
  sender_color: string;
}

const MINIMIZE_DRAG_PX = 70;
const MINI_W = 200;
const MINI_H = Math.round((MINI_W * 9) / 16);
const EDGE_GAP = 12;
// Clearance so the resting mini player never sits under the floating pill bar.
const BOTTOM_GAP = 104;
const TAP_SLOP_PX = 8;

export const WatchScreen: React.FC = () => {
  const isLoading = useAppStore((s) => s.isLoading);
  const streamUrl = useAppStore((s) => s.streamUrl);
  const currentStream = useAppStore((s) => s.currentStream);
  const currentHypeTrain = useAppStore((s) => s.currentHypeTrain);
  const exitStream = useAppStore((s) => s.exitStream);
  const playerMode = useMobileNavStore((s) => s.playerMode);
  const setPlayerMode = useMobileNavStore((s) => s.setPlayerMode);
  const refreshNonce = usePinStore((s) => s.refreshNonce);
  const orientation = useOrientation();
  const [landscapeChat, setLandscapeChat] = useState(false);
  const [pip, setPip] = useState(false);
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const chatTabsVisible = useChatTabsVisible();
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  const [miniPos, setMiniPos] = useState(() => ({
    x: window.innerWidth - MINI_W - EDGE_GAP,
    y: window.innerHeight - MINI_H - BOTTOM_GAP,
  }));
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const movedRef = useRef(false);

  const mini = playerMode === 'mini';
  const watching = !!streamUrl && streamUrl !== 'offline';
  const channelId = currentStream?.user_id;

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // System PiP strip-down flag from MainActivity. Also mirrored onto <html> so
  // the lifecycle handler can tell real backgrounding from PiP: Android fires
  // visibilitychange=hidden for both, but in PiP the video is still on screen
  // and must keep playing.
  useEffect(() => {
    const onPip = (e: Event) => {
      const active = !!(e as CustomEvent<boolean>).detail;
      setPip(active);
      document.documentElement.dataset.snPip = active ? 'true' : 'false';
    };
    window.addEventListener('sn:pip', onPip);
    return () => {
      window.removeEventListener('sn:pip', onPip);
      delete document.documentElement.dataset.snPip;
    };
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
    const immersive = watching && orientation === 'landscape' && !mini && !pip;
    setImmersive(immersive);
    return () => setImmersive(false);
  }, [watching, orientation, mini, pip]);

  // A newly started stream always opens full (external store sync).
  useEffect(() => {
    if (channelId) setPlayerMode('full');
  }, [channelId, setPlayerMode]);

  // Pinned messages: 30s poll + instant refresh on pin/unpin actions.
  useEffect(() => {
    if (!channelId || !watching) {
      // Clearing on channel change is part of syncing server state into local
      // state, which is what this effect exists for.
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

  // Drag the full-size player band downward to shrink into the mini player.
  const onBandTouchStart = useCallback((e: React.TouchEvent) => {
    dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, px: 0, py: 0 };
  }, []);
  const onBandTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const start = dragStart.current;
      if (!start) return;
      const dy = e.touches[0].clientY - start.y;
      const dx = Math.abs(e.touches[0].clientX - start.x);
      if (dy > MINIMIZE_DRAG_PX && dy > dx * 1.5) {
        dragStart.current = null;
        setPlayerMode('mini');
      }
    },
    [setPlayerMode],
  );
  const onBandTouchEnd = useCallback(() => {
    dragStart.current = null;
  }, []);

  // Free-drag the mini player anywhere; release snaps it to the nearest side.
  const onMiniPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragStart.current = { x: e.clientX, y: e.clientY, px: miniPos.x, py: miniPos.y };
      movedRef.current = false;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [miniPos.x, miniPos.y],
  );

  const onMiniPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = dragStart.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) movedRef.current = true;
      setMiniPos({
        x: Math.max(EDGE_GAP, Math.min(viewport.w - MINI_W - EDGE_GAP, start.px + dx)),
        y: Math.max(EDGE_GAP, Math.min(viewport.h - MINI_H - EDGE_GAP, start.py + dy)),
      });
    },
    [viewport.w, viewport.h],
  );

  const onMiniPointerUp = useCallback(() => {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDragging(false);
    // Snap to whichever side the player ended up closest to.
    setMiniPos((pos) => ({
      x: pos.x + MINI_W / 2 < viewport.w / 2 ? EDGE_GAP : viewport.w - MINI_W - EDGE_GAP,
      y: Math.min(pos.y, viewport.h - MINI_H - BOTTOM_GAP),
    }));
  }, [viewport.w, viewport.h]);

  if (!streamUrl && !isLoading) return null;

  if (isLoading && !streamUrl) {
    return (
      <div className="absolute inset-0 z-40 bg-background flex items-center justify-center">
        <LoadingWidget fullScreen={false} useFunnyMessages={true} />
      </div>
    );
  }

  // ONE TREE FOR EVERY MODE. This used to be three separate `return`s (PiP,
  // landscape, portrait) and that was the reason rotating or entering PiP
  // reloaded the stream: React reconciles by position and type, so swapping the
  // root subtree unmounted MobilePlayer, and with it the <video> element and the
  // hls.js instance, then built a fresh one. Portrait full <-> mini was always
  // smooth for the opposite reason, and now every mode gets that property.
  //
  // The rule this render has to keep: the ancestor chain from the root down to
  // <MobilePlayer> is IDENTICAL in all four modes. Modes may change classes,
  // styles and geometry, never structure. Conditional SIBLINGS are fine.
  const isLandscape = orientation === 'landscape' && !mini && !pip;

  // Geometry of the whole layer. PiP and landscape fill the screen; mini is a
  // draggable box; portrait is the viewport.
  const layerGeometry =
    pip || isLandscape
      ? { top: 0, left: 0, width: viewport.w, height: viewport.h, borderRadius: 0 }
      : mini
        ? { top: miniPos.y, left: miniPos.x, width: MINI_W, height: MINI_H, borderRadius: 12 }
        : { top: 0, left: 0, width: viewport.w, height: viewport.h, borderRadius: 0 };

  // The player fills the layer in every mode except portrait, where it is a
  // 16:9 band above chat.
  const playerBandClass =
    pip || mini
      ? 'w-full h-full relative'
      : isLandscape
        ? 'flex-1 min-w-0 h-full relative'
        : 'w-full aspect-video relative shrink-0';

  // Chat is a column below in portrait, a side panel in landscape, and hidden
  // (but still MOUNTED) in mini and PiP. Hidden rather than unmounted so
  // rotating or popping into PiP does not tear down the chat connection either.
  const chatClass = pip
    ? 'hidden'
    : isLandscape
      ? landscapeChat
        ? 'w-[320px] shrink-0 relative flex flex-col bg-background'
        : 'hidden'
      : mini
        ? 'hidden'
        : 'flex-1 min-h-0 relative flex flex-col';

  return (
    <motion.div
      className={`fixed overflow-hidden ${pip ? 'z-50' : 'z-40'} ${
        mini ? 'shadow-[0_12px_32px_-8px_rgba(0,0,0,0.65)]' : ''
      }`}
      style={{
        backgroundColor: pip || isLandscape ? '#000' : 'var(--color-background)',
        touchAction: mini ? 'none' : undefined,
      }}
      initial={false}
      animate={layerGeometry}
      transition={
        dragging ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36, mass: 0.7 }
      }
      onPointerDown={mini ? onMiniPointerDown : undefined}
      onPointerMove={mini ? onMiniPointerMove : undefined}
      onPointerUp={mini ? onMiniPointerUp : undefined}
      onPointerCancel={mini ? onMiniPointerUp : undefined}
      onClick={
        mini
          ? () => {
              if (!movedRef.current) setPlayerMode('full');
            }
          : undefined
      }
    >
      <div
        className={`w-full h-full flex ${isLandscape ? 'flex-row' : 'flex-col'}`}
        style={{
          // Only portrait-full needs to clear the status bar; landscape draws
          // under it deliberately and mini/PiP have no bar over them.
          paddingTop: mini || pip || isLandscape ? 0 : 'var(--sn-safe-t, 0px)',
        }}
      >
        {/* The player keeps this exact tree position in EVERY mode, so the video
            element and the hls.js instance survive rotation, PiP and minimize. */}
        <div
          className={playerBandClass}
          onTouchStart={mini || isLandscape ? undefined : onBandTouchStart}
          onTouchMove={mini || isLandscape ? undefined : onBandTouchMove}
          onTouchEnd={mini || isLandscape ? undefined : onBandTouchEnd}
        >
          <MobilePlayer
            immersive={isLandscape || pip}
            compact={mini || pip}
            onEnterPip={mini || pip ? undefined : enterPip}
            onToggleFullscreen={isLandscape ? () => setLandscapeChat((v) => !v) : undefined}
          />
          {mini && (
            <>
              {/* Swallow player taps so the whole box reads as one control. */}
              <div className="absolute inset-0 z-10" />
              <button
                className="absolute top-1 right-1 z-20 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-white"
                aria-label="Close stream"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void exitStream();
                }}
              >
                <X size={14} weight="bold" />
              </button>
            </>
          )}
        </div>

        <div className={chatClass}>
          {/* Chat header carries only live, transient signal now: the hype
              train and the pinned message. The persistent stream info lives in
              the player overlay, so chat keeps its full height. */}
          {/* Always mounted, hidden when empty. DropProgressBar has to run to
              discover whether there is a drop to show, and gating the wrapper on
              its answer would mean it never mounts to give one. `hidden` still
              mounts children and runs their effects, so this breaks that cycle
              without painting an empty strip. */}
            <div
              className={
                currentHypeTrain || pinned.length > 0 || dropActive
                  ? 'absolute left-0 right-0 px-3.5 py-1.5 border-b border-borderSubtle backdrop-blur-ultra z-10 pointer-events-none shadow-lg overflow-hidden flex flex-col-reverse'
                  : 'hidden'
              }
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-background) 90%, transparent)',
                // Sits BELOW the chat tab strip when several rooms are open.
                // This header is absolutely positioned over the top of the chat
                // column, so at top:0 it covered the tabs completely.
                top: chatTabsVisible ? CHAT_TAB_STRIP_H : 0,
              }}
            >
              {currentHypeTrain && (
                <HypeTrainBanner
                  train={currentHypeTrain}
                  onExpire={() => useAppStore.getState().setCurrentHypeTrain(null)}
                />
              )}
              {/* Live drop progress for this stream. flex-col-reverse means
                  DOM order here renders ABOVE the pinned strip and below the
                  info row. */}
              <DropProgressBar onActiveChange={setDropActive} />
              {pinned.length > 0 && (
                <button
                  onClick={() => setPinsOpen(true)}
                  className="pointer-events-auto flex items-center gap-1.5 text-left"
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
            </div>

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
      </div>

      {/* Pinned messages, expanded. */}
      <MobileSheet open={pinsOpen} onClose={() => setPinsOpen(false)} title="Pinned">
        <div className="flex flex-col gap-3">
          {pinned.map((pin) => (
            <div key={pin.id} className="text-[14px] leading-relaxed">
              <span className="font-semibold" style={{ color: pin.sender_color || undefined }}>
                {pin.sender_name}
              </span>
              <span className="text-textPrimary">: {pin.message_text}</span>
            </div>
          ))}
        </div>
      </MobileSheet>
    </motion.div>
  );
};
