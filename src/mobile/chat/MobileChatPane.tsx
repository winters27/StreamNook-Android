// Mobile chat: ChatMessageList (the full cosmetics render path: paints, badges,
// atmosphere washes) + a lean touch input. Deliberately NOT ChatWidget: that
// component drags mod tools, mod rooms, and MultiNook into the bundle. This
// pane speaks to chatConnectionStore through the same APIs.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ChatMessageList from '../../components/ChatMessageList';
import { useTwitchChat } from '../../hooks/useTwitchChat';
import { useChannelEmotes } from '../../stores/chatConnectionStore';
import { useAppStore } from '../../stores/AppStore';
import { useChatUserStore } from '../../stores/chatUserStore';
import { parseMessage } from '../../services/twitchChat';
import type { BackendChatMessage } from '../../services/twitchChat';
import { Logger } from '../../utils/logger';
import { MobileChatInput } from './MobileChatInput';
import { UserSheet, type SheetUser } from './UserSheet';

export const MobileChatPane: React.FC = () => {
  const currentStream = useAppStore((s) => s.currentStream);
  const currentUser = useAppStore((s) => s.currentUser);
  const chat = useTwitchChat();
  const {
    messages,
    connectChat,
    isConnected,
    renderToken,
    deletedMessageIds,
    clearedUserContexts,
    setPaused,
  } = chat;

  const emotes = useChannelEmotes(
    currentStream?.user_login ?? null,
    currentStream?.user_id ?? null,
    'twitch',
  );

  const [isPaused, setIsPausedState] = useState(false);
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  const processedIds = useRef(new Set<string>());

  // Connect chat for the watched channel.
  useEffect(() => {
    if (!currentStream?.user_login) return;
    processedIds.current.clear();
    void connectChat(currentStream.user_login, currentStream.user_id);
  }, [currentStream?.user_login, currentStream?.user_id, connectChat]);

  // Seed YOUR OWN row on connect: Twitch never echoes your PRIVMSG back, so the
  // per-message loop below never adds you, and your paint/badge would have
  // nothing to attach to. Mirrors ChatWidget's own-user seeding.
  useEffect(() => {
    if (!isConnected || !currentUser?.user_id) return;
    useChatUserStore.getState().addUser({
      userId: currentUser.user_id,
      username: currentUser.login || currentUser.username || '',
      displayName: currentUser.display_name || currentUser.username || currentUser.user_id,
      color: '#9147FF',
    });
  }, [isConnected, currentUser?.user_id, currentUser]);

  // Register every chatter with chatUserStore: this is what triggers the
  // per-user cosmetics fetch (7TV paint/badge, third-party badges). Lean
  // Twitch-only mirror of ChatWidget's message-processing effect.
  useEffect(() => {
    const { addUser } = useChatUserStore.getState();
    const seen = processedIds.current;
    const currentIds = new Set<string>();

    for (const message of messages) {
      let msgId: string | undefined;
      if (typeof message === 'string') {
        const m = message.match(/(?:^@|;)id=([^;\s]+)/);
        msgId = m ? m[1] : undefined;
      } else {
        msgId = (message as BackendChatMessage).id;
      }
      if (msgId) {
        currentIds.add(msgId);
        if (seen.has(msgId)) continue;
        seen.add(msgId);
      }

      try {
        let userId: string | undefined;
        let username: string | undefined;
        let displayName: string | undefined;
        let userColor: string | undefined;
        let channelId: string | undefined;

        if (typeof message === 'string') {
          const channelIdMatch = message.match(/room-id=([^;]+)/);
          channelId = channelIdMatch ? channelIdMatch[1] : undefined;
          const parsed = parseMessage(message, channelId);
          userId = parsed.tags.get('user-id');
          username = parsed.username;
          displayName = parsed.tags.get('display-name') || parsed.username;
          userColor = parsed.color;
        } else {
          const backend = message as BackendChatMessage;
          const parsed = parseMessage(backend);
          userId = backend.tags['user-id'] || backend.user_id;
          username = backend.username;
          displayName = backend.display_name || backend.username;
          userColor = backend.color || parsed.color;
          channelId = backend.tags['room-id'];
        }

        if (userId && username && displayName) {
          const ctxId = channelId || currentStream?.user_id || '';
          const ctxName = currentStream?.user_login || currentStream?.user_name || '';
          addUser(
            { userId, username, displayName, color: userColor || '#9147FF' },
            ctxId ? { channelId: ctxId, channelName: ctxName } : undefined,
          );
        }
      } catch (err) {
        Logger.error('[MobileChatPane] failed to parse message:', err, message);
      }
    }

    for (const id of seen) {
      if (!currentIds.has(id)) seen.delete(id);
    }
  }, [messages, renderToken, currentStream?.user_id, currentStream?.user_login, currentStream?.user_name]);

  const getMessageId = useCallback((message: string | BackendChatMessage): string | null => {
    if (typeof message !== 'string') return message.id;
    const idMatch = message.match(/(?:^|;)id=([^;]+)/);
    return idMatch ? idMatch[1] : null;
  }, []);

  const pause = useCallback(
    (p: boolean) => {
      setIsPausedState(p);
      setPaused(p);
    },
    [setPaused],
  );

  const onScroll = useCallback(
    (distanceToBottom: number) => {
      if (distanceToBottom < 24 && isPaused) pause(false);
    },
    [isPaused, pause],
  );

  const onUsernameClick = useCallback(
    (userId: string, username: string, displayName: string, color: string) => {
      setSheetUser({ userId, username, displayName, color });
    },
    [],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <ChatMessageList
          messages={messages}
          renderToken={renderToken}
          isPaused={isPaused}
          onPauseIntent={() => pause(true)}
          onScroll={onScroll}
          onUsernameClick={onUsernameClick}
          onReplyClick={() => {}}
          onEmoteRightClick={() => {}}
          onUsernameRightClick={() => {}}
          onBadgeClick={() => {}}
          highlightedMessageId={null}
          deletedMessageIds={deletedMessageIds}
          clearedUserContexts={clearedUserContexts}
          emotes={emotes}
          getMessageId={getMessageId}
        />
        {isPaused && (
          <button
            onClick={() => pause(false)}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 glass-button px-4 py-2 text-[13px] font-semibold text-textPrimary z-10"
          >
            Chat paused, tap to resume
          </button>
        )}
      </div>
      <MobileChatInput chat={chat} emotes={emotes} />
      <UserSheet user={sheetUser} onClose={() => setSheetUser(null)} />
    </div>
  );
};
