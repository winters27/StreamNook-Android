// Lean touch chat input: text send + emote sheet. Deliberately drops the
// desktop input's slash commands, user-command expansion, resub/streak modes,
// send-as switching, and arrow history; those are desktop affordances.
import React, { useRef, useState } from 'react';
import { PaperPlaneRight, Smiley } from 'phosphor-react';
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
    <div className="shrink-0 flex items-end gap-1.5 px-2.5 py-2 border-t border-borderSubtle">
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
      <button
        onClick={() => void send()}
        disabled={!text.trim() || sending}
        className="sn-touch flex items-center justify-center text-accent disabled:text-textMuted"
        aria-label="Send"
      >
        <PaperPlaneRight size={22} weight="fill" />
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
