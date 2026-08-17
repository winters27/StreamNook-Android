import { useEffect, useRef } from 'react';
import { useChatUserStore } from '../stores/chatUserStore';
import type { BackendChatMessage } from '../services/twitchChat';

/**
 * Resolve the ACCOUNT-level cosmetics for a set of chat messages: 7TV paint, 7TV badge,
 * a StreamNook member's curated third-party badges (BTTV / FFZ / Chatterino / Homies /
 * Chatsen / Chatty / DankChat), their Atmosphere wash, and Cologne chrome.
 *
 * `ChatMessage` READS all of these out of `chatUserStore` — something else has to put
 * them in. In the main chat that is ChatWidget's message effect, so any surface that
 * renders `ChatMessageList` WITHOUT ChatWidget (the clip modal's replay column) shows
 * bare names without this. The failure is quiet and easy to misread as "cosmetics are
 * broken", because the cosmetics that ride the message itself still render fine: text,
 * Twitch and third-party emotes, native Twitch badges, username color, and the
 * StreamNook member badge (a synchronous registry lookup, not a store read).
 *
 * `addUser` resolves all of it and is idempotent per user, so one call per unique
 * chatter is enough — hence the ref-guarded set rather than firing per message.
 */
export function useChatCosmetics(messages: BackendChatMessage[]): void {
  const resolved = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!messages.length) return;
    const { addUser } = useChatUserStore.getState();
    for (const m of messages) {
      // Replay hands us objects, but the shared list type also allows raw IRC
      // strings; those carry no resolved identity, so skip them.
      if (!m || typeof m === 'string') continue;
      const userId = m.user_id;
      if (!userId || !m.username) continue;
      // Mirrors ChatMessage's `cosmeticsKey`: non-Twitch ids are namespaced so a
      // Twitch and a Kick id of the same number can't collide in the shared store.
      const provider = m.provider ?? 'twitch';
      const key = provider === 'twitch' ? userId : `${provider}:${userId}`;
      if (resolved.current.has(key)) continue;
      resolved.current.add(key);
      addUser({
        userId: key,
        username: m.username,
        displayName: m.display_name || m.username,
        color: m.color || '#9147FF',
      });
    }
  }, [messages]);
}
