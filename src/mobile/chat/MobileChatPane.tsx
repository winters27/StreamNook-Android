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
import { ChatTabStrip } from './ChatTabStrip';
import { AddChatSheet } from './AddChatSheet';
import { useChatTabsStore } from './chatTabsStore';
import { banUser, deleteMessage, isModeratorFrom, pinMessage, unbanUser } from './modActions';
import { deriveChatGating } from './chatGating';
import { ChatFanOut, type FanAction, type FanTarget } from './ChatFanOut';
import { useLongPressDrag } from './useLongPressDrag';
import { usePinStore } from '../../stores/pinStore';
import { formatDuration } from '../../utils/timeoutRamp';

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
  /** Every Helix mod action keys off the channel's numeric id. */
  const broadcasterId = activeTab?.channelId ?? null;
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
  // Long-press arms the fan-out over the pressed row; it owns every message
  // action now, so there is no separate action sheet.
  const [fanTarget, setFanTarget] = useState<FanTarget | null>(null);
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

  /** Pull the author and body out of a rendered row's message id. */
  const describeMessage = useCallback(
    (messageId: string) => {
      for (const message of messages) {
        if (getMessageId(message) !== messageId) continue;
        try {
          const parsed = parseMessage(message as string | BackendChatMessage);
          const username = parsed.username ?? '';
          if (!username) return null;
          return {
            messageId,
            username,
            userId: parsed.tags.get('user-id') ?? '',
            content: parsed.content ?? '',
          };
        } catch {
          return null;
        }
      }
      return null;
    },
    [messages, getMessageId],
  );

  // Suppress the synthesized contextmenu entirely: the fan-out owns the hold now,
  // and letting both fire would open a menu behind the fan.
  const onListContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const listRef = useRef<HTMLDivElement | null>(null);

  const resolveRow = useCallback(
    (el: HTMLElement) => el.getAttribute('data-message-id'),
    [],
  );

  const onArmFan = useCallback(
    (messageId: string, x: number, y: number) => {
      const found = describeMessage(messageId);
      if (!found) return;
      setFanTarget({ ...found, originX: x, originY: y });
    },
    [describeMessage],
  );

  const press = useLongPressDrag({
    resolve: resolveRow,
    onArm: onArmFan,
    scrollLockRef: listRef,
  });

  const closeFan = useCallback(() => {
    setFanTarget(null);
    press.release();
  }, [press]);

  const runFanAction = useCallback(
    (action: FanAction, timeoutSecs?: number) => {
      const t = fanTarget;
      closeFan();
      if (!t) return;
      switch (action) {
        case 'reply':
          setReplyDraft({
            messageId: t.messageId,
            username: t.username,
            channel: activeChannel ?? '',
          });
          break;
        case 'copy':
          void navigator.clipboard.writeText(t.content).catch(() => {});
          break;
        case 'profile':
          setSheetUser({
            userId: t.userId,
            username: t.username,
            displayName: t.username,
            color: '#9147FF',
          });
          break;
        case 'delete':
          if (broadcasterId) {
            void deleteMessage(broadcasterId, t.messageId).then(
              (ok) => !ok && addToast('Could not delete that message.', 'error'),
            );
          }
          break;
        case 'timeout':
          if (broadcasterId && t.userId) {
            void banUser(broadcasterId, t.userId, timeoutSecs ?? 600).then((ok) => {
              if (!ok) addToast('Could not time out that user.', 'error');
              else
                addToast(
                  `Timed out ${t.username} for ${formatDuration(timeoutSecs ?? 600)}`,
                  'success',
                  {
                    label: 'Undo',
                    onClick: () => void unbanUser(broadcasterId, t.userId),
                  },
                );
            });
          }
          break;
        case 'ban':
          if (broadcasterId && t.userId) {
            void banUser(broadcasterId, t.userId, null).then((ok) => {
              if (!ok) addToast('Could not ban that user.', 'error');
              else
                addToast(`Banned ${t.username}`, 'success', {
                  label: 'Undo',
                  onClick: () => void unbanUser(broadcasterId, t.userId),
                });
            });
          }
          break;
        case 'pin':
          if (broadcasterId) {
            void pinMessage(broadcasterId, t.messageId).then((ok) => {
              if (ok) usePinStore.getState().requestRefresh();
              else addToast('Could not pin that message.', 'error');
            });
          }
          break;
      }
    },
    [fanTarget, closeFan, activeChannel, broadcasterId, addToast],
  );

  // Tap-to-reply, but only while paused. A live list scrolls under your finger,
  // so a tap on a moving row is a coin flip; pausing makes the target stable.
  // Paused rows get a visible reply affordance (see ChatMessageList styling via
  // the data attribute below) so the gesture is discoverable rather than secret.
  const onListClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isPaused || press.isArmed()) return;
      const el = e.target as HTMLElement;
      // Usernames and links keep their own behaviour.
      if (el.closest('a,[data-no-drag],button')) return;
      const row = el.closest('[data-message-id]');
      if (!row) return;
      const messageId = row.getAttribute('data-message-id');
      if (!messageId) return;
      const found = describeMessage(messageId);
      if (!found) return;
      setReplyDraft({
        messageId: found.messageId,
        username: found.username,
        channel: activeChannel ?? '',
      });
    },
    [isPaused, press, describeMessage, activeChannel],
  );


  const row =
    'sn-touch flex items-center px-2 text-[15px] text-textPrimary active:opacity-70 disabled:opacity-50';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ChatTabStrip />
      <div
        ref={listRef}
        // `select-none` is load-bearing, not tidiness: Android WebView answers a
        // long-press on text by starting its OWN text selection, which wins the
        // gesture and the fan never arms. Chat text needs no selection anyway —
        // the fan's Copy bucket is the way to take a message.
        className="flex-1 min-h-0 relative select-none [-webkit-touch-callout:none]"
        onContextMenu={onListContextMenu}
        onPointerDown={press.onPointerDown}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
        onClick={onListClick}
        // While paused, rows are tappable to reply. Signposted by the hint pill
        // below rather than left as a secret gesture.
        data-tap-reply={isPaused ? 'true' : undefined}
      >
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
          <div className="absolute bottom-2 left-0 right-0 flex flex-col items-center gap-1 z-10 pointer-events-none">
            <span className="glass-badge rounded-full px-2 py-0.5 text-[10.5px] text-textMuted">
              Tap a message to reply
            </span>
            <button
              onClick={resumeLive}
              className="pointer-events-auto glass-button flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-medium text-textPrimary"
            >
              <CaretDown size={11} weight="bold" />
              Resume live
            </button>
          </div>
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
      {/* Long-press fan-out. Owns every per-message action now, for everyone:
          moderators simply get more buckets. */}
      <ChatFanOut
        target={fanTarget}
        isModerator={modToolsArmed}
        canPin={modToolsArmed && !!broadcasterId}
        onCommit={runFanAction}
        onCancel={closeFan}
      />
    </div>
  );
};
