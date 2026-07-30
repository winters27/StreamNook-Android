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
import { X } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import { usePinStore } from '../../stores/pinStore';
import { useWindowShape } from '../ui/useWindowShape';
import {
  readWatchLayout,
  readWatchSplit,
  writeWatchLayout,
  writeWatchSplit,
  type WatchLayout,
} from '../watch/watchLayout';
import { SplitHandle } from '../watch/SplitHandle';
import { MobilePlayer } from '../player/MobilePlayer';
import { MobileChatPane } from '../chat/MobileChatPane';
import {
  CHAT_TAB_STRIP_H,
  useActiveChatChannelId,
  useChatTabsVisible,
  useViewingStreamChat,
} from '../chat/ChatTabStrip';
import { DropProgressBar } from '../watch/DropProgressBar';
import { PinnedBanner } from '../watch/PinnedBanner';
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
  const shape = useWindowShape();
  const [landscapeChat, setLandscapeChat] = useState(false);
  const [watchLayout, setWatchLayout] = useState<WatchLayout>(readWatchLayout);
  const [chatSplit, setChatSplit] = useState<number | null>(readWatchSplit);
  const [pip, setPip] = useState(false);
  const [pinnedFor, setPinnedFor] = useState<{
    channel: string | null;
    items: PinnedMessage[];
  }>({ channel: null, items: [] });
  const [pinsOpen, setPinsOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const chatTabsVisible = useChatTabsVisible();
  const viewingStreamChat = useViewingStreamChat();
  const chatChannelId = useActiveChatChannelId();
  // Only surface pins that belong to the room currently on screen.
  const pinned = pinnedFor.channel === chatChannelId ? pinnedFor.items : [];
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

  // Side by side is decided by AVAILABLE WIDTH, not by orientation. An unfolded
  // Z Fold is about 840x757 — an aspect ratio near 1.1 — so asking "portrait or
  // landscape" there gives an answer that means nothing, and the old check handed
  // a big tablet-shaped screen the phone's stacked layout.
  // A vertical hinge says WHERE to split if we split left/right. It does not say
  // that we should. The crease on an unfolded Fold sits at the middle, so
  // honouring it gives the player ~420dp of width: a 236dp-tall video stranded
  // in a 757dp-tall column, which reads as a small picture on a mostly black
  // pane. Stacking that same screen gets a 472dp video with chat still 285dp
  // tall. So choose the arrangement that gives the VIDEO the most height while
  // leaving chat something usable, instead of assuming a big screen wants
  // columns.
  const MIN_CHAT_W = 300;
  const MIN_CHAT_H = 240;
  const sideVideoH = (shape.splitX * 9) / 16;
  const stackVideoH = (shape.w * 9) / 16;
  const sideFits = shape.w - shape.splitX >= MIN_CHAT_W;
  const stackFits = shape.h - stackVideoH >= MIN_CHAT_H;
  // ...but only as a DEFAULT. Both arrangements are legitimate on a near-square
  // screen: columns trade picture size for full-height chat, stacked trades
  // pillarbox bars for a big picture. That is the viewer's call, so `auto` is
  // just the starting point and an explicit choice always wins.
  const autoColumns = sideFits && (!stackFits || sideVideoH >= stackVideoH);
  // Offer the switch only where both actually work; below that there is nothing
  // to choose between.
  const canChooseLayout = shape.sizeClass === 'expanded' && sideFits && stackFits;
  // Only `expanded` re-decides. A phone in landscape is after immersive video,
  // so chat stays opt-in behind the fullscreen toggle there, as before.
  const twoColumns =
    shape.sizeClass === 'expanded'
      ? watchLayout === 'auto'
        ? autoColumns
        : watchLayout === 'columns' && sideFits
      : landscapeChat;
  const immersiveLandscape = shape.twoPane && shape.sizeClass !== 'expanded';
  const sideBySide = shape.twoPane && !mini && !pip && (twoColumns || immersiveLandscape);
  const chatBeside = sideBySide && twoColumns;
  // Resizable only where there is genuinely a trade to make. On a phone the
  // 16:9 band is simply right, and there is no surplus to hand to chat.
  const resizable = shape.sizeClass === 'expanded' && !mini && !pip;
  // The axis the divider travels along, and the natural split it starts from:
  // a 16:9 player with chat taking whatever is left.
  const axisLen = chatBeside ? shape.w : shape.h;
  const naturalPlayer = chatBeside ? shape.splitX : (shape.w * 9) / 16;
  const MIN_CHAT = chatBeside ? 260 : 150;
  const MIN_PLAYER = chatBeside ? 240 : 120;
  const desiredPlayer = chatSplit != null ? axisLen * (1 - chatSplit) : naturalPlayer;
  const playerMain = resizable
    ? Math.max(MIN_PLAYER, Math.min(axisLen - MIN_CHAT, desiredPlayer))
    : naturalPlayer;
  // Where the seam falls. On a Fold this is the hinge itself, so neither pane is
  // bisected by the crease; elsewhere the split the viewer chose.
  const playerWidth = chatBeside ? playerMain : shape.w;

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
    // Hide the system bars only when video actually fills the screen. With chat
    // beside it on a tablet or an unfolded Fold the bars are wanted.
    setImmersive(watching && sideBySide && !chatBeside);
    return () => setImmersive(false);
  }, [watching, sideBySide, chatBeside]);

  // A newly started stream always opens full (external store sync).
  useEffect(() => {
    if (channelId) setPlayerMode('full');
  }, [channelId, setPlayerMode]);

  // Pinned messages: 30s poll + instant refresh on pin/unpin actions.
  //
  // Keyed to the CHAT on screen, not to the stream. A pinned message is a
  // property of the room you are reading, so with several tabs open, fetching
  // against `currentStream` left one channel's pin sitting above another
  // channel's messages and appearing to jump between them as you switched.
  //
  // The result is stamped with the channel it describes and compared on read, so
  // a slow response cannot land under the wrong room and nothing has to clear
  // state from inside the effect.
  useEffect(() => {
    if (!chatChannelId || !watching) return;
    let cancelled = false;
    const fetchPins = async () => {
      try {
        const messages = await invoke<PinnedMessage[]>('get_pinned_chat_messages', {
          channelId: chatChannelId,
        });
        if (cancelled) return;
        setPinnedFor({ channel: chatChannelId, items: messages || [] });
        usePinStore
          .getState()
          .setPinnedIds((messages || []).map((m) => m.message_id).filter(Boolean));
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
  }, [chatChannelId, watching, refreshNonce]);

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
  // Geometry of the whole layer. PiP and side-by-side fill the screen; mini is a
  // draggable box; stacked is the viewport.
  const layerGeometry =
    mini && !pip
      ? { top: miniPos.y, left: miniPos.x, width: MINI_W, height: MINI_H, borderRadius: 12 }
      : { top: 0, left: 0, width: viewport.w, height: viewport.h, borderRadius: 0 };

  // The player fills the layer except in the stacked layout, where it is a 16:9
  // band above chat.
  const playerBandClass =
    pip || mini
      ? 'w-full h-full relative'
      : sideBySide
        ? 'shrink-0 h-full relative'
        : // A resizable band gets an explicit height; aspect-video would fight
          // it. The video is object-contain either way, so a band shorter than
          // 16:9 pillarboxes instead of cropping or stretching.
          //
          // Stacked, video meets chat at a hard edge, and the player should
          // read as floating above it. Two deliberate choices:
          //
          // The rim is ACCENT-tinted, not a white hairline. Every divider in
          // the shell (chat tabs, settings rows, composer, pinned) already uses
          // borderSubtle, so a faint white line here just looked like one more
          // list divider in a place that is not a list. color-mix keeps it
          // tracking whichever of the themes is active.
          //
          // The cast is layered and ACCENT-TINTED rather than black. Measured on
          // device, the chat column sits at rgb(13,12,13): a black shadow over
          // that paints nothing at all. It was present in computed style and
          // completely invisible. On a near-black surface a raised edge has to
          // be described by light, not by darkening, so this is a dispersed
          // bloom in the theme's accent, widening and fading across three
          // layers.
          //
          // z-20, not z-10, and that is the whole reason this is visible. The
          // chat header (drop bar / pinned strip) is `absolute` at the top of
          // the chat column at z-10 with a 90%-opaque background and a 64px
          // backdrop blur. Tied on z-index and later in the DOM, it won, and it
          // painted over the cast: an OPAQUE RED test shadow came back as
          // rgb(26,12,13), about 5% of red. Nothing about the shadow was ever
          // weak; it was being covered by a panel that only exists while a drop
          // or a pin is showing, which is why it looked intermittent.
          // A SEPARATOR, not a wash. The wide 64px third layer was reaching far
          // enough down the chat column to tint everything under the player,
          // which is what made it read as a glow no matter how low the alpha
          // went. Two tight layers instead, dying out within ~24px, so the
          // effect is confined to the edge it is describing.
          //
          // z-10, below the chat header's z-20: the pinned card and drop bar
          // float ON the cast rather than being washed by it.
          `w-full relative shrink-0 z-10 border-b border-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] shadow-[0_3px_8px_-2px_color-mix(in_srgb,var(--color-accent)_10%,transparent),0_8px_18px_-8px_color-mix(in_srgb,var(--color-accent)_6%,transparent)] ${
            resizable ? '' : 'aspect-video'
          }`;

  // Chat is a column below when stacked, a side panel when side by side, and
  // hidden (but still MOUNTED) in mini and PiP. Hidden rather than unmounted so
  // folding, rotating or popping into PiP never tears down the chat connection.
  const chatClass = pip
    ? 'hidden'
    : sideBySide
      ? chatBeside
        ? 'flex-1 min-w-0 relative flex flex-col bg-background'
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
        backgroundColor: pip || sideBySide ? '#000' : 'var(--color-background)',
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
        className={`w-full h-full flex ${sideBySide ? 'flex-row' : 'flex-col'}`}
        style={{
          // Only portrait-full needs to clear the status bar; landscape draws
          // under it deliberately and mini/PiP have no bar over them.
          paddingTop: mini || pip || sideBySide ? 0 : 'var(--sn-safe-t, 0px)',
        }}
      >
        {/* The player keeps this exact tree position in EVERY mode, so the video
            element and the hls.js instance survive rotation, PiP and minimize. */}
        <div
          className={playerBandClass}
          // Explicit width only when split: this is what puts the seam ON the
          // hinge, rather than letting flex choose a boundary the crease then
          // cuts straight through.
          style={
            sideBySide
              ? { width: playerWidth }
              : resizable
                ? { height: playerMain }
                : undefined
          }
          onTouchStart={mini || sideBySide ? undefined : onBandTouchStart}
          onTouchMove={mini || sideBySide ? undefined : onBandTouchMove}
          onTouchEnd={mini || sideBySide ? undefined : onBandTouchEnd}
        >
          <MobilePlayer
            immersive={sideBySide || pip}
            compact={mini || pip}
            onEnterPip={mini || pip ? undefined : enterPip}
            onToggleFullscreen={sideBySide ? () => setLandscapeChat((v) => !v) : undefined}
            layoutMode={twoColumns ? 'columns' : 'stacked'}
            onToggleLayout={
              canChooseLayout && !mini && !pip
                ? () => {
                    // Writes an explicit choice, so it stops tracking `auto` and
                    // survives a restart.
                    const next: WatchLayout = twoColumns ? 'stacked' : 'columns';
                    setWatchLayout(next);
                    writeWatchLayout(next);
                  }
                : undefined
            }
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

        {/* Between the panes, so its parent rect is the container the drag
            measures against. Hidden in mini/PiP and on phones. */}
        {resizable && (sideBySide ? chatBeside : true) && (
          <SplitHandle
            axis={chatBeside ? 'x' : 'y'}
            length={axisLen}
            minChat={MIN_CHAT}
            minPlayer={MIN_PLAYER}
            // Only meaningful across a vertical hinge, and only when the panes
            // are side by side; a horizontal divider cannot land on it.
            snapAt={chatBeside && shape.fold?.vertical ? shape.splitX : null}
            onDrag={(frac) => {
              setChatSplit(frac);
              writeWatchSplit(frac);
            }}
            onReset={() => {
              setChatSplit(null);
              writeWatchSplit(null);
            }}
          />
        )}

        <div
          className={chatClass}
          style={
            // Side by side, the row deliberately carries no top padding so the
            // video runs edge to edge under the status bar. Chat is not video:
            // without its own inset the first message renders behind the clock.
            sideBySide && chatBeside ? { paddingTop: 'var(--sn-safe-t, 0px)' } : undefined
          }
        >
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
                (viewingStreamChat && (currentHypeTrain || dropActive)) || pinned.length > 0
                  ? // Pure layout now: no background, no border, no blur, no
                    // shadow. Each child already carries its own container
                    // (PinnedBanner is an sn-popover, the hype train draws its
                    // own filled bar), so wrapping them in a full-width panel
                    // put a box inside a box and killed any sense of the pinned
                    // message floating over chat.
                    //
                    // z-20 keeps these cards ABOVE the player's cast, so the
                    // glow passes behind them instead of washing across them.
                    'absolute left-0 right-0 px-2.5 pt-1.5 pb-2 z-20 pointer-events-none flex flex-col-reverse gap-1'
                  : 'hidden'
              }
              style={{
                // Sits BELOW the chat tab strip when several rooms are open.
                // This header is absolutely positioned over the top of the chat
                // column, so at top:0 it covered the tabs completely.
                top: chatTabsVisible ? CHAT_TAB_STRIP_H : 0,
              }}
            >
              {/* Hype train and drop progress belong to the STREAM, not to
                  whichever chat tab you are reading. Showing them over another
                  room's chat credits them to the wrong channel. */}
              {viewingStreamChat && currentHypeTrain && (
                <HypeTrainBanner
                  train={currentHypeTrain}
                  onExpire={() => useAppStore.getState().setCurrentHypeTrain(null)}
                />
              )}
              {/* flex-col-reverse means DOM order here renders ABOVE the pinned
                  strip and below the info row. Kept mounted even on another tab
                  so its poll keeps running; it just does not render there. */}
              <DropProgressBar
                onActiveChange={setDropActive}
                visible={viewingStreamChat}
              />
              <PinnedBanner
                pins={pinned}
                expanded={pinsOpen}
                onToggle={() => setPinsOpen((v) => !v)}
              />
            </div>

          {/* Poll + prediction cards, exactly the desktop components: they
              self-fetch off the channel and anchor under the header. Stream
              scoped, so same rule as the hype train above. */}
          {currentStream && viewingStreamChat && (
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

    </motion.div>
  );
};
