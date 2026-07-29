// Lean touch chat input: text send, the shared emote/emoji picker, and channel
// points. Deliberately drops the desktop input's slash commands, user-command
// expansion, resub/streak modes, send-as switching, and arrow history; those
// are desktop affordances.
//
// The picker and the points menu are the SAME components the desktop composer
// uses. Both are prop-driven, carry no window/hover dependencies, and anchor
// themselves with `absolute bottom-full` — so they only need a `relative`
// ancestor here, and mobile gets provider tabs, favorites, emoji and search for
// free instead of a second, worse implementation.
import React, { useRef, useState } from 'react';
import { X } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { incrementStat } from '../../services/supabaseService';
import { refreshChannelEmotes } from '../../stores/chatConnectionStore';
import type { UseTwitchChatReturn } from '../../hooks/useTwitchChat';
import type { EmoteSet } from '../../services/emoteService';
import { Logger } from '../../utils/logger';
import { EmotePickerPanel, useSwappingSmiley } from '../../components/chat/EmotePickerPanel';
import ChannelPointsMenu from '../../components/ChannelPointsMenu';
import { ChannelPointsIcon } from '../../components/ChannelPointsIcon';
import { useChannelPoints } from './useChannelPoints';
import { useEmoteOwnerNames } from './useEmoteOwnerNames';

// Shorter than the desktop's 520px so the panel still clears the soft keyboard,
// and opaque rather than the panel's own 95%. That 5% reads as solid over a
// desktop-sized popover but lets a whole screen of chat show through at phone
// size, which is most of what made the old picker hard to read. `!` is needed
// because the shared panel sets its background inline.
//
// Deliberately NOT solved with a backdrop blur: that gets stripped entirely
// when Glassiness is off, so it cannot be what keeps text legible, and a large
// blur is exactly the per-frame cost just removed from chat rows for phone GPUs.
// The height clamp is keyboard-aware on purpose. `vh` is the whole screen here
// (edge-to-edge means the soft keyboard does not resize the viewport, the native
// inset bridge reports it as --sn-kb instead), so a fixed 52vh panel grows
// straight up past the status bar once the keyboard opens.
const PANEL_CLASS =
  'absolute bottom-full left-0 right-0 mb-2 h-[52vh] max-h-[min(420px,calc(100dvh-var(--sn-kb,0px)-var(--sn-safe-t,0px)-140px))] border border-borderSubtle rounded-xl shadow-lg flex flex-col overflow-hidden origin-bottom z-50 !bg-background';

function formatPoints(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export const MobileChatInput: React.FC<{
  chat: UseTwitchChatReturn;
  emotes: EmoteSet | null;
  replyTo?: { messageId: string; username: string } | null;
  onCancelReply?: () => void;
}> = ({ chat, emotes, replyTo, onCancelReply }) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const currentStream = useAppStore((s) => s.currentStream);
  const [text, setText] = useState('');
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { currentSmiley, isSmileyTransitioning, cycleEmoteSmiley } = useSwappingSmiley();
  const points = useChannelPoints(currentStream?.user_login);
  const emoteOwnerNames = useEmoteOwnerNames(emotes);

  const send = async () => {
    const message = text.trim();
    if (!message || !currentUser || sending) return;
    setSending(true);
    try {
      await chat.sendMessage(
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
      <button
        onClick={() => {
          cycleEmoteSmiley();
          setPointsOpen(false);
          setEmotesOpen((v) => !v);
        }}
        className="sn-touch flex items-center justify-center text-[21px] leading-none active:opacity-70"
        aria-label="Emotes and emoji"
      >
        <span
          className="transition-[opacity,transform] duration-100"
          style={{
            opacity: isSmileyTransitioning ? 0 : 1,
            transform: isSmileyTransitioning ? 'scale(0.8)' : 'scale(1)',
          }}
        >
          {currentSmiley}
        </span>
      </button>
      {/* Points only exist for Twitch channels with points enabled, and only
          once the drops account is connected, so a null balance hides it
          rather than showing a control that cannot work. */}
      {points.balance !== null && currentStream && (
        <button
          onClick={() => {
            setEmotesOpen(false);
            setPointsOpen((v) => !v);
          }}
          className={`sn-touch flex items-center gap-1 px-1.5 rounded-full active:opacity-70 ${
            pointsOpen ? 'text-accent' : 'text-textSecondary'
          }`}
          aria-label={`${points.name || 'Channel points'}: ${points.balance}`}
        >
          {points.iconUrl ? (
            <img
              src={points.iconUrl}
              alt=""
              className="w-[18px] h-[18px] object-contain"
              draggable={false}
            />
          ) : (
            <ChannelPointsIcon size={17} />
          )}
          <span className="text-[12.5px] font-semibold tabular-nums">
            {formatPoints(points.balance)}
          </span>
        </button>
      )}
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
        placeholder="Send a message"
        rows={1}
        className="glass-input flex-1 resize-none px-3 py-2 text-[15px] leading-[1.4] text-textPrimary placeholder:text-textMuted bg-transparent outline-none max-h-[96px]"
        enterKeyHint="send"
      />
      {/* Same send control as the desktop chat: glass button + the app's own
          send glyph. */}
      <button
        onClick={() => void send()}
        disabled={!text.trim() || sending}
        className="glass-button flex-shrink-0 flex items-center justify-center self-end w-10 h-10 text-white rounded transition-all duration-300 disabled:opacity-50"
        aria-label="Send"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
      <EmotePickerPanel
        open={emotesOpen}
        onClose={() => setEmotesOpen(false)}
        emotes={emotes}
        isTwitch
        isKick={false}
        channelId={currentStream?.user_id}
        channelLogin={currentStream?.user_login}
        isLoadingEmotes={!emotes}
        channelNameCache={emoteOwnerNames}
        onInsert={insertEmote}
        className={PANEL_CLASS}
      />
      {pointsOpen && currentStream && (
        <ChannelPointsMenu
          channelLogin={currentStream.user_login}
          channelId={currentStream.user_id}
          currentBalance={points.balance}
          customPointsName={points.name}
          customPointsIconUrl={points.iconUrl}
          onClose={() => setPointsOpen(false)}
          onBalanceUpdate={points.refresh}
          onEmotesChange={() => {
            // Redeeming an emote-unlock reward changes the picker's contents.
            if (currentStream.user_id) {
              void refreshChannelEmotes(currentStream.user_login, currentStream.user_id);
            }
          }}
        />
      )}
      </div>
    </div>
  );
};
