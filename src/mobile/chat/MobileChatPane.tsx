// Mobile chat: ChatMessageList (the full cosmetics render path: paints, badges,
// atmosphere washes) + a lean touch composer, over N concurrent channels.
// Deliberately NOT ChatWidget: that component drags mod rooms and MultiNook into
// the bundle.
//
// Channels are owned by chatTabsStore, which holds a reference-counted
// subscription per tab, so every open room stays connected and switching tabs is
// a re-render rather than a reconnect. This pane renders whichever tab is active
// via `useChannelChat`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown } from 'phosphor-react';
import ChatMessageList from '../../components/ChatMessageList';
import {
  setChannelPaused,
  useChannelChat,
  useChannelEmotes,
} from '../../stores/chatConnectionStore';
import { useAppStore } from '../../stores/AppStore';
import { useChatUserStore } from '../../stores/chatUserStore';
import { parseMessage } from '../../services/twitchChat';
import type { BackendChatMessage } from '../../services/twitchChat';
import { Logger } from '../../utils/logger';
import { MobileChatInput } from './MobileChatInput';
import { UserSheet, type SheetUser } from './UserSheet';
import { MobileSheet } from '../ui/MobileSheet';
import { ChatTabStrip } from './ChatTabStrip';
import { AddChatSheet } from './AddChatSheet';
import { useChatTabsStore } from './chatTabsStore';
import { TIMEOUT_OPTIONS, banUser, deleteMessage, isModeratorFrom } from './modActions';
import { deriveChatGating } from './chatGating';

export const MobileChatPane: React.FC = () => {
  const currentStream = useAppStore((s) => s.currentStream);
  const currentUser = useAppStore((s) => s.currentUser);
  const addToast = useAppStore((s) => s.addToast);

  const tabs = useChatTabsStore((s) => s.tabs);
  const activeChannel = useChatTabsStore((s) => s.activeChannel);
  const syncStreamTab = useChatTabsStore((s) => s.syncStreamTab);
  const removeTab = useChatTabsStore((s) => s.removeTab);
  const reload = useChatTabsStore((s) => s.reload);

  // Keep the stream-following tab pointed at whatever is playing.
  useEffect(() => {
    syncStreamTab(
      currentStream?.user_login ?? null,
      currentStream?.user_id ?? null,
      currentStream?.user_name || currentStream?.user_login || '',
      currentStream?.profile_image_url ?? null,
    );
  }, [
    currentStream?.user_login,
    currentStream?.user_id,
    currentStream?.user_name,
    currentStream?.profile_image_url,
    syncStreamTab,
  ]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.channel === activeChannel) ?? null,
    [tabs, activeChannel],
  );

  const chat = useChannelChat(activeChannel);
  const {
    messages,
    renderToken,
    deletedMessageIds,
    clearedUserContexts,
    userBadges,
    roomState,
    isConnected,
  } = chat;

  const emotes = useChannelEmotes(activeChannel, activeTab?.channelId ?? null, 'twitch');

  const isModerator = isModeratorFrom(userBadges);
  const gating = useMemo(() => deriveChatGating(roomState, userBadges), [roomState, userBadges]);
  const [modToolsOn, setModToolsOn] = useState(false);
  // Losing mod powers (switching to a room you do not moderate) must not leave
  // the destructive actions armed.
  const modToolsArmed = isModerator && modToolsOn;

  // Paused state and the reply draft are keyed BY CHANNEL rather than reset when
  // you switch tabs. Same outcome, but nothing has to write state from an effect
  // (which is a cascading-render error under react-hooks v7), and coming back to
  // a room restores nothing stale because the key simply stops matching.
  const [pausedChannel, setPausedChannel] = useState<string | null>(null);
  const isPaused = !!activeChannel && pausedChannel === activeChannel;

  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  const [addChatOpen, setAddChatOpen] = useState(false);
  const [timeoutTarget, setTimeoutTarget] = useState<{
    userId: string;
    username: string;
  } | null>(null);
  // Long-press a message (Android synthesizes contextmenu -> the RightClick
  // callbacks) to open the action sheet; Reply threads through the input.
  const [actionTarget, setActionTarget] = useState<{
    messageId: string;
    username: string;
    userId: string;
    content: string;
  } | null>(null);
  const [replyDraft, setReplyDraft] = useState<{
    messageId: string;
    username: string;
    channel: string;
  } | null>(null);
  const replyTo = replyDraft && replyDraft.channel === activeChannel ? replyDraft : null;

  // Dedupe set for the cosmetics registration loop, tagged with the channel it
  // describes so switching rooms invalidates it without an effect reset.
  const processed = useRef<{ channel: string | null; ids: Set<string> }>({
    channel: null,
    ids: new Set(),
  });

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
    if (processed.current.channel !== activeChannel) {
      processed.current = { channel: activeChannel, ids: new Set() };
    }
    const seen = processed.current.ids;
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
          const ctxId = channelId || activeTab?.channelId || '';
          const ctxName = activeTab?.channel || '';
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
  }, [messages, renderToken, activeChannel, activeTab?.channelId, activeTab?.channel]);

  const getMessageId = useCallback((message: string | BackendChatMessage): string | null => {
    if (typeof message !== 'string') return message.id;
    const idMatch = message.match(/(?:^|;)id=([^;]+)/);
    return idMatch ? idMatch[1] : null;
  }, []);

  const pause = useCallback(
    (p: boolean) => {
      if (!activeChannel) return;
      setPausedChannel(p ? activeChannel : null);
      setChannelPaused(activeChannel, p);
    },
    [activeChannel],
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

  const broadcasterId = activeTab?.channelId ?? null;

  const row =
    'sn-touch flex items-center px-2 text-[15px] text-textPrimary active:opacity-70 disabled:opacity-50';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ChatTabStrip />
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
        channel={activeChannel}
        channelId={broadcasterId}
        channelLabel={activeTab?.label ?? null}
        gating={gating}
        emotes={emotes}
        replyTo={replyTo}
        onCancelReply={() => setReplyDraft(null)}
        isModerator={isModerator}
        modToolsOn={modToolsOn}
        onToggleModTools={() => setModToolsOn((v) => !v)}
        onAddChat={() => setAddChatOpen(true)}
        onReload={() => activeChannel && reload(activeChannel)}
        onCloseChat={
          activeTab && !activeTab.pinnedToStream
            ? () => removeTab(activeTab.channel)
            : undefined
        }
      />
      <UserSheet user={sheetUser} onClose={() => setSheetUser(null)} />
      <AddChatSheet open={addChatOpen} onClose={() => setAddChatOpen(false)} />

      {/* Message action sheet (long-press a message). */}
      <MobileSheet
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        maxHeightFraction={modToolsArmed ? 0.55 : 0.4}
      >
        {actionTarget && (
          <div className="flex flex-col">
            <div className="px-2 pb-2 text-[13px] text-textMuted truncate">
              {actionTarget.username}
              {actionTarget.content ? `: ${actionTarget.content}` : ''}
            </div>
            <button
              onClick={() => {
                setReplyDraft({ messageId: actionTarget.messageId, username: actionTarget.username, channel: activeChannel ?? '' });
                setActionTarget(null);
              }}
              className={row}
            >
              Reply
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(actionTarget.content).catch(() => {});
                setActionTarget(null);
              }}
              disabled={!actionTarget.content}
              className={row}
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
              className={row}
            >
              View profile
            </button>

            {/* Mod actions are behind the explicit Moderator tools toggle so a
                destructive tap is never one long-press away by accident. */}
            {modToolsArmed && broadcasterId && (
              <>
                <div className="mt-1.5 mb-0.5 h-px bg-borderSubtle" />
                <button
                  onClick={() => {
                    const target = actionTarget;
                    setActionTarget(null);
                    void deleteMessage(broadcasterId, target.messageId).then((ok) =>
                      addToast(ok ? 'Message deleted' : 'Could not delete that message.', ok ? 'success' : 'error'),
                    );
                  }}
                  className={row}
                >
                  Delete message
                </button>
                <button
                  onClick={() => {
                    const target = actionTarget;
                    setActionTarget(null);
                    setTimeoutTarget({ userId: target.userId, username: target.username });
                  }}
                  disabled={!actionTarget.userId}
                  className={row}
                >
                  Timeout {actionTarget.username}
                </button>
                <button
                  onClick={() => {
                    const target = actionTarget;
                    setActionTarget(null);
                    void banUser(broadcasterId, target.userId, null).then((ok) =>
                      addToast(
                        ok ? `Banned ${target.username}` : 'Could not ban that user.',
                        ok ? 'success' : 'error',
                      ),
                    );
                  }}
                  disabled={!actionTarget.userId}
                  className={`${row} !text-error`}
                >
                  Ban {actionTarget.username}
                </button>
              </>
            )}
          </div>
        )}
      </MobileSheet>

      {/* Timeout duration picker. */}
      <MobileSheet
        open={!!timeoutTarget}
        onClose={() => setTimeoutTarget(null)}
        title={timeoutTarget ? `Timeout ${timeoutTarget.username}` : undefined}
        maxHeightFraction={0.4}
      >
        {timeoutTarget && broadcasterId && (
          <div className="flex flex-col">
            {TIMEOUT_OPTIONS.map((opt) => (
              <button
                key={opt.seconds}
                onClick={() => {
                  const target = timeoutTarget;
                  setTimeoutTarget(null);
                  void banUser(broadcasterId, target.userId, opt.seconds).then((ok) =>
                    addToast(
                      ok ? `${target.username} timed out for ${opt.label}` : 'Could not time out that user.',
                      ok ? 'success' : 'error',
                    ),
                  );
                }}
                className={row}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </MobileSheet>
    </div>
  );
};
