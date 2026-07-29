// Mobile chat: ChatMessageList (the full cosmetics render path: paints, badges,
// atmosphere washes) + a lean touch input. Deliberately NOT ChatWidget: that
// component drags mod tools, mod rooms, and MultiNook into the bundle. This
// pane speaks to chatConnectionStore through the same APIs.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CaretDown } from 'phosphor-react';
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
import { MobileSheet } from '../ui/MobileSheet';

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
  // Long-press a message (Android synthesizes contextmenu -> the RightClick
  // callbacks) to open the action sheet; Reply threads through the input.
  const [actionTarget, setActionTarget] = useState<{
    messageId: string;
    username: string;
    userId: string;
    content: string;
  } | null>(null);
  const [replyTo, setReplyTo] = useState<{ messageId: string; username: string } | null>(null);
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

  // Returning to live: unpause, then let the list glide smoothly to the bottom
  // (ChatMessageList exposes its eased scroll for exactly this).
  const resumeLive = useCallback(() => {
    pause(false);
    requestAnimationFrame(() => {
      (
        window as Window & typeof globalThis & { __chatScrollToBottom?: () => void }
      ).__chatScrollToBottom?.();
    });
  }, [pause]);

  const onUsernameClick = useCallback(
    (userId: string, username: string, displayName: string, color: string) => {
      setSheetUser({ userId, username, displayName, color });
    },
    [],
  );

  const openMessageActions = useCallback(
    (messageId: string, usernameHint?: string) => {
      let content = '';
      let userId = '';
      let username = usernameHint ?? '';
      for (const message of messages) {
        if (getMessageId(message) !== messageId) continue;
        try {
          const parsed = parseMessage(message as string | BackendChatMessage);
          content = parsed.content ?? '';
          userId = parsed.tags.get('user-id') ?? '';
          if (!username) username = parsed.username ?? '';
        } catch {
          content = '';
        }
        break;
      }
      if (!username) return;
      setActionTarget({ messageId, username, userId, content });
    },
    [messages, getMessageId],
  );

  // Long-press ANYWHERE on a message row opens the action sheet, not just the
  // username: Android synthesizes contextmenu from the hold, and every row
  // carries data-message-id (see ChatMessageList's MessageRow).
  const onListContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const row = (e.target as HTMLElement).closest('[data-message-id]');
      if (!row) return;
      e.preventDefault();
      const messageId = row.getAttribute('data-message-id');
      if (messageId) openMessageActions(messageId);
    },
    [openMessageActions],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 relative" onContextMenu={onListContextMenu}>
        <ChatMessageList
          messages={messages}
          renderToken={renderToken}
          isPaused={isPaused}
          onPauseIntent={() => pause(true)}
          onScroll={onScroll}
          onUsernameClick={onUsernameClick}
          onReplyClick={() => {}}
          onEmoteRightClick={() => {}}
          onUsernameRightClick={openMessageActions}
          onBadgeClick={() => {}}
          highlightedMessageId={null}
          deletedMessageIds={deletedMessageIds}
          clearedUserContexts={clearedUserContexts}
          emotes={emotes}
          getMessageId={getMessageId}
        />
        {isPaused && (
          <button
            onClick={resumeLive}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 glass-button flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-medium text-textPrimary z-10"
          >
            <CaretDown size={11} weight="bold" />
            Resume live
          </button>
        )}
      </div>
      <MobileChatInput
        chat={chat}
        emotes={emotes}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
      <UserSheet user={sheetUser} onClose={() => setSheetUser(null)} />

      {/* Message action sheet (long-press a chatter's name). */}
      <MobileSheet
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        maxHeightFraction={0.4}
      >
        {actionTarget && (
          <div className="flex flex-col">
            <div className="px-2 pb-2 text-[13px] text-textMuted truncate">
              {actionTarget.username}
              {actionTarget.content ? `: ${actionTarget.content}` : ''}
            </div>
            <button
              onClick={() => {
                setReplyTo({ messageId: actionTarget.messageId, username: actionTarget.username });
                setActionTarget(null);
              }}
              className="sn-touch flex items-center px-2 text-[15px] text-textPrimary active:opacity-70"
            >
              Reply
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(actionTarget.content).catch(() => {});
                setActionTarget(null);
              }}
              disabled={!actionTarget.content}
              className="sn-touch flex items-center px-2 text-[15px] text-textPrimary active:opacity-70 disabled:opacity-50"
            >
              Copy message
            </button>
            <button
              onClick={() => {
                const target = actionTarget;
                setActionTarget(null);
                setSheetUser({
                  userId: target.userId,
                  username: target.username,
                  displayName: target.username,
                  color: '#9147FF',
                });
              }}
              className="sn-touch flex items-center px-2 text-[15px] text-textPrimary active:opacity-70"
            >
              View profile
            </button>
          </div>
        )}
      </MobileSheet>
    </div>
  );
};
