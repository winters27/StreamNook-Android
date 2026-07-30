// Lean touch chat composer: text send, the shared emote/emoji picker, channel
// points, and a menu that shares the trailing slot with Send. Deliberately drops
// the desktop input's slash commands, user-command expansion, resub/streak
// modes, send-as switching, and arrow history; those are desktop affordances.
//
// The picker and the points menu are the SAME components the desktop composer
// uses. Both are prop-driven, carry no window/hover dependencies, and anchor
// themselves with `absolute bottom-full` — so they only need a `relative`
// ancestor here, and mobile gets provider tabs, favorites, emoji and search for
// free instead of a second, worse implementation.
//
// Channel comes in as a prop rather than being read off `currentStream`: with
// several chat tabs open the composer must target the tab you are looking at,
// which is not necessarily the stream playing.
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import { DotsThreeVertical, Lock, X } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { incrementStat } from '../../services/supabaseService';
import { refreshChannelEmotes, sendChannelMessage } from '../../stores/chatConnectionStore';
import type { EmoteSet } from '../../services/emoteService';
import { Logger } from '../../utils/logger';
import { EmotePickerPanel, useSwappingSmiley } from '../../components/chat/EmotePickerPanel';
import ChannelPointsMenu from '../../components/ChannelPointsMenu';
import { ChannelPointsIcon } from '../../components/ChannelPointsIcon';
import { useChannelPoints } from './useChannelPoints';
import { useEmoteOwnerNames } from './useEmoteOwnerNames';
import { ComposerMenuSheet } from './ComposerMenuSheet';
import { StreakBanners } from './StreakBanners';
import type { ChatGating } from './chatGating';

// Shorter than the desktop's 520px so the panel still clears the soft keyboard,
// and opaque rather than the panel's own 95%. That 5% reads as solid over a
// desktop-sized popover but lets a whole screen of chat show through at phone
// size, which is most of what made the old picker hard to read. `!` is needed
// because the shared panel sets its background inline.
//
// Deliberately NOT solved with a backdrop blur: that gets stripped entirely
// when Glassiness is off, so it cannot be what keeps text legible, and a large
// blur is exactly the per-frame cost just removed from chat rows for phone GPUs.
//
// The height clamp is keyboard-aware on purpose. `vh` is the whole screen here
// (edge-to-edge means the soft keyboard does not resize the viewport, the native
// inset bridge reports it as --sn-kb instead), so a fixed 52vh panel grows
// straight up past the status bar once the keyboard opens.
const PANEL_CLASS =
  'absolute bottom-full left-0 right-0 mb-2 h-[52vh] max-h-[min(420px,calc(100dvh-var(--sn-kb,0px)-var(--sn-safe-t,0px)-140px))] border border-borderSubtle rounded-xl shadow-lg flex flex-col overflow-hidden origin-bottom z-50 !bg-background';

interface Props {
  channel: string | null;
  channelId: string | null;
  channelLabel: string | null;
  gating: ChatGating;
  emotes: EmoteSet | null;
  replyTo?: { messageId: string; username: string } | null;
  onCancelReply?: () => void;
  isModerator: boolean;
  modToolsOn: boolean;
  onToggleModTools: () => void;
  onAddChat: () => void;
  onReload: () => void;
  /** Absent for the stream-following tab, which is not closable. */
  onCloseChat?: () => void;
}

export const MobileChatInput: React.FC<Props> = ({
  channel,
  channelId,
  channelLabel,
  gating,
  emotes,
  replyTo,
  onCancelReply,
  isModerator,
  modToolsOn,
  onToggleModTools,
  onAddChat,
  onReload,
  onCloseChat,
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const [text, setText] = useState('');
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { currentSmiley, isSmileyTransitioning, cycleEmoteSmiley } = useSwappingSmiley();
  const points = useChannelPoints(channel);
  const emoteOwnerNames = useEmoteOwnerNames(emotes);

  // Points feedback.
  //
  // The event is `channel-points-earned` with a `points` field. It is NOT
  // `channel-points-claimed`, which nothing in the Rust source has ever emitted
  // — the mobile boot listener was waiting on that name too, which is why
  // earning has been silent on this platform from the start rather than only
  // since toasts were filtered to failures.
  //
  // Emitted by the PubSub watcher (channel_points_websocket_service) and the
  // background claim path, both of which run on mobile.
  const [pointsFlash, setPointsFlash] = useState<{ id: number; amount: number } | null>(null);
  const flashSeq = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const un = listen<{ points?: number; channel_id?: string }>(
      'channel-points-earned',
      (e) => {
        if (cancelled) return;
        const amount = e.payload?.points ?? 0;
        if (amount <= 0) return;
        // Points accrue on every channel you have collected from, not only the
        // one on screen, so ignore events for other channels or the number would
        // appear over the wrong room's balance.
        if (e.payload?.channel_id && channelId && e.payload.channel_id !== channelId) return;
        flashSeq.current += 1;
        setPointsFlash({ id: flashSeq.current, amount });
        // Pull the new balance so the menu is right if you open it straight after.
        points.refresh();
      },
    );
    return () => {
      cancelled = true;
      void un.then((f) => f()).catch(() => {});
    };
  }, [points, channelId]);

  const canSend = !!text.trim();

  const send = async () => {
    const message = text.trim();
    if (!message || !currentUser || !channel || sending) return;
    setSending(true);
    try {
      await sendChannelMessage(
        channel,
        message,
        {
          username: currentUser.login || currentUser.username,
          displayName: currentUser.display_name || currentUser.username,
          userId: currentUser.user_id,
          color: undefined,
          badges: '',
        },
        replyTo?.messageId,
      );
      setText('');
      onCancelReply?.();
      incrementStat(currentUser.user_id, 'messages_sent', 1).catch((err) => {
        Logger.warn('[MobileChatInput] messages_sent stat failed:', err);
      });
    } catch (err) {
      Logger.error('[MobileChatInput] send failed:', err);
    } finally {
      setSending(false);
    }
  };

  // The shared picker hands back the literal token to insert, which is an emote
  // name for emotes and the character itself for emoji.
  const insertEmote = (token: string) => {
    setText((t) => (t.length === 0 || t.endsWith(' ') ? `${t}${token} ` : `${t} ${token} `));
    inputRef.current?.focus();
  };

  return (
    // Bottom padding: ride the soft keyboard (--sn-kb, pushed by the native
    // WindowInsets bridge; targetSdk 36 edge-to-edge ignores adjustResize) and
    // clear the gesture pill when the keyboard is closed. SUM, not max: the
    // bridge reports the keyboard height minus the gesture bar, so the full
    // lift above the keyboard is kb + safe-b (max left the input clipped by
    // exactly the gesture-bar height).
    <div
      className="shrink-0 border-t border-borderSubtle"
      style={{
        paddingBottom: 'calc(var(--sn-kb, 0px) + var(--sn-safe-b, 0px) + 10px)',
        transition: 'padding-bottom 0.15s ease-out',
      }}
    >
      {/* Shareable streaks, same place desktop puts them: directly above the
          composer, because sharing sends whatever you have typed along with it. */}
      <StreakBanners
        channel={channel}
        channelId={channelId}
        message={text}
        onShared={() => setText('')}
      />
      {/* Only surfaced here when it actually stops you sending. A room being in
          followers-only while you CAN still talk is context, not an alert, so it
          lives in the chat menu instead of taking a line above the composer. */}
      {gating.blocked && (
        <div className="flex items-center gap-1.5 px-3 pt-1.5 text-[11.5px] text-warning">
          <Lock size={11} weight="bold" className="shrink-0" />
          <span className="truncate">{gating.reason}</span>
        </div>
      )}
      {replyTo && (
        <div className="flex items-center gap-1.5 px-3 pt-1.5 text-[12.5px] text-textSecondary">
          <span className="truncate">
            Replying to <span className="font-semibold">@{replyTo.username}</span>
          </span>
          <button
            onClick={onCancelReply}
            className="ml-auto p-1.5 text-textMuted active:text-textPrimary"
            aria-label="Cancel reply"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {/* `relative` is the anchor both panels position against. */}
      <div className="relative flex items-end gap-1.5 px-2.5 pt-2">
        {/* The emote trigger and the points button live INSIDE the field so the
            typing area keeps full width instead of being squeezed by chrome. */}
        <div className="glass-input flex-1 min-w-0 flex items-end gap-1 pl-1 pr-2">
          <button
            onClick={() => {
              cycleEmoteSmiley();
              setPointsOpen(false);
              setEmotesOpen((v) => !v);
            }}
            className={`shrink-0 w-9 h-9 flex items-center justify-center text-[20px] leading-none active:opacity-70 ${
              emotesOpen ? 'text-accent' : ''
            }`}
            aria-label={emotesOpen ? 'Close emotes' : 'Emotes and emoji'}
          >
            {/* Becomes an X while open, so the button that opened the panel is
                visibly the one that closes it. Same swap the desktop composer
                does. */}
            {emotesOpen ? (
              <X size={19} weight="bold" />
            ) : (
              <span
                className="transition-[opacity,transform] duration-100"
                style={{
                  opacity: isSmileyTransitioning ? 0 : 1,
                  transform: isSmileyTransitioning ? 'scale(0.8)' : 'scale(1)',
                }}
              >
                {currentSmiley}
              </span>
            )}
          </button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={gating.blocked ? (gating.reason ?? 'Chat restricted') : 'Send a message'}
            // Typing is switched off, not just discouraged, when the badges prove
            // the send would be rejected. The amber placeholder says why.
            disabled={!!gating.blocked}
            rows={1}
            className={`flex-1 min-w-0 resize-none bg-transparent py-2 text-[15px] leading-[1.4] text-textPrimary outline-none max-h-[96px] ${
              gating.blocked
                ? 'placeholder:text-warning placeholder:font-medium'
                : 'placeholder:text-textMuted'
            }`}
            enterKeyHint="send"
          />
          {/* Icon only. The balance belongs in the menu that opens, where there
              is room to show it in full rather than abbreviated. */}
          {points.balance !== null && channel && (
            <button
              onClick={() => {
                setEmotesOpen(false);
                setPointsOpen((v) => !v);
              }}
              className={`relative shrink-0 w-9 h-9 flex items-center justify-center active:opacity-70 ${
                pointsOpen ? 'text-accent' : 'text-textSecondary'
              }`}
              aria-label={pointsOpen ? 'Close channel points' : points.name || 'Channel points'}
            >
              {/* The amount, floating up and away. Keyed on a counter so two
                  claims close together each get their own animation instead of
                  the second being swallowed as "same element". */}
              <AnimatePresence>
                {pointsFlash && (
                  <motion.span
                    key={pointsFlash.id}
                    className="absolute left-1/2 -translate-x-1/2 pointer-events-none text-[11px] font-bold text-accent whitespace-nowrap"
                    initial={{ opacity: 0, y: 2, scale: 0.8 }}
                    animate={{ opacity: 1, y: -18, scale: 1 }}
                    exit={{ opacity: 0, y: -26 }}
                    transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
                    onAnimationComplete={() => setPointsFlash(null)}
                  >
                    +{pointsFlash.amount}
                  </motion.span>
                )}
              </AnimatePresence>
              <motion.span
                className="flex items-center justify-center"
                animate={
                  pointsFlash
                    ? { scale: [1, 1.35, 1], filter: ['brightness(1)', 'brightness(1.6)', 'brightness(1)'] }
                    : { scale: 1 }
                }
                transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
              >
                {pointsOpen ? (
                  <X size={19} weight="bold" />
                ) : points.iconUrl ? (
                  <img
                    src={points.iconUrl}
                    alt=""
                    className="w-[19px] h-[19px] object-contain"
                    draggable={false}
                  />
                ) : (
                  <ChannelPointsIcon size={19} />
                )}
              </motion.span>
            </button>
          )}
        </div>

        {/* One slot, two jobs: Send while there is a message, otherwise the chat
            menu. Avoids parking a permanently disabled Send on screen. */}
        {canSend ? (
          <button
            onClick={() => void send()}
            disabled={sending}
            className="glass-button shrink-0 flex items-center justify-center self-end w-10 h-10 text-white rounded transition-all duration-300 disabled:opacity-50"
            aria-label="Send"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => {
              setEmotesOpen(false);
              setPointsOpen(false);
              setMenuOpen(true);
            }}
            className="glass-button shrink-0 flex items-center justify-center self-end w-10 h-10 rounded text-textSecondary active:text-textPrimary transition-all duration-300"
            aria-label="Chat options"
          >
            <DotsThreeVertical size={20} weight="bold" />
          </button>
        )}

        <EmotePickerPanel
          open={emotesOpen}
          onClose={() => setEmotesOpen(false)}
          emotes={emotes}
          isTwitch
          isKick={false}
          channelId={channelId ?? undefined}
          channelLogin={channel ?? undefined}
          isLoadingEmotes={!emotes}
          channelNameCache={emoteOwnerNames}
          onInsert={insertEmote}
          className={PANEL_CLASS}
        />
        {pointsOpen && channel && channelId && (
          <ChannelPointsMenu
            channelLogin={channel}
            channelId={channelId}
            currentBalance={points.balance}
            customPointsName={points.name}
            customPointsIconUrl={points.iconUrl}
            onClose={() => setPointsOpen(false)}
            onBalanceUpdate={points.refresh}
            onEmotesChange={() => {
              // Redeeming an emote-unlock reward changes the picker's contents.
              void refreshChannelEmotes(channel, channelId);
            }}
          />
        )}
      </div>

      <ComposerMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeChannel={channel}
        activeLabel={channelLabel}
        isModerator={isModerator}
        gatingLabels={gating.labels}
        modToolsOn={modToolsOn}
        onToggleModTools={onToggleModTools}
        onAddChat={onAddChat}
        onReload={onReload}
        onCloseChat={onCloseChat}
      />
    </div>
  );
};
