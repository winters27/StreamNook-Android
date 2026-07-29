// Lean touch chat input: text send + emote sheet. Deliberately drops the
// desktop input's slash commands, user-command expansion, resub/streak modes,
// send-as switching, and arrow history; those are desktop affordances.
import React, { useRef, useState } from 'react';
import { Smiley } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { incrementStat } from '../../services/supabaseService';
import type { UseTwitchChatReturn } from '../../hooks/useTwitchChat';
import type { EmoteSet } from '../../services/emoteService';
import { Logger } from '../../utils/logger';
import { EmoteSheet } from './EmoteSheet';

export const MobileChatInput: React.FC<{
  chat: UseTwitchChatReturn;
  emotes: EmoteSet | null;
}> = ({ chat, emotes }) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const [text, setText] = useState('');
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    const message = text.trim();
    if (!message || !currentUser || sending) return;
    setSending(true);
    try {
      await chat.sendMessage(message, {
        username: currentUser.login || currentUser.username,
        displayName: currentUser.display_name || currentUser.username,
        userId: currentUser.user_id,
        color: undefined,
        badges: '',
      });
      setText('');
      incrementStat(currentUser.user_id, 'messages_sent', 1).catch((err) => {
        Logger.warn('[MobileChatInput] messages_sent stat failed:', err);
      });
    } catch (err) {
      Logger.error('[MobileChatInput] send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const insertEmote = (name: string) => {
    setText((t) => (t.length === 0 || t.endsWith(' ') ? `${t}${name} ` : `${t} ${name} `));
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
      className="shrink-0 flex items-end gap-1.5 px-2.5 pt-2 border-t border-borderSubtle"
      style={{
        paddingBottom: 'calc(var(--sn-kb, 0px) + var(--sn-safe-b, 0px) + 10px)',
        transition: 'padding-bottom 0.15s ease-out',
      }}
    >
      <button
        onClick={() => setEmotesOpen(true)}
        className="sn-touch flex items-center justify-center text-textSecondary active:text-textPrimary"
        aria-label="Emotes"
      >
        <Smiley size={22} />
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
      <EmoteSheet
        open={emotesOpen}
        onClose={() => setEmotesOpen(false)}
        emotes={emotes}
        onPick={insertEmote}
      />
    </div>
  );
};
