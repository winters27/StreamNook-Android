// Owns every mod-room connection in this window, independent of what is
// rendered. Hosts refcount rooms in (ensureRoom/releaseRoom) for the channels
// they have open; the pane is just a view over the store. The manager runs the
// decrypt pipeline (mentions can only be detected client-side: the server never
// sees plaintext), tracks unread against a persisted last-read watermark, and
// reconciles optimistic sends via a nonce that travels inside the ciphertext.

import { connectModRoom, type ModRoomChat, type ModRoomController } from './modRoomService';
import { decryptText, importRoomKey, isEncrypted } from './modRoomCrypto';
import { emptySession, useModRoomStore, type ResolvedPayload } from '../stores/modRoomStore';
import { ensureAtmosphereResolved, useChatUserStore } from '../stores/chatUserStore';

const MESSAGE_CAP = 800;
const PENDING_TIMEOUT_MS = 10_000;
const TYPING_TTL_MS = 3000;
const LASTREAD_KEY = 'modroom_lastread_v1';
const LASTREAD_MAX_ENTRIES = 50;

interface ManagedRoom {
  refs: number;
  ctrl: ModRoomController;
  viewing: boolean;
}

const rooms = new Map<string, ManagedRoom>();
const decryptInFlight = new Set<string>();
let windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true;

const store = () => useModRoomStore.getState();

// Register a sender with the shared chat user store so cosmetics (7TV paint,
// atmosphere, StreamNook badge) resolve and decorate the row, like live chat.
function ensureUser(userId: string, login: string) {
  if (!userId) return;
  useChatUserStore.getState().addUser({ userId, username: login, displayName: login, color: '' });
  ensureAtmosphereResolved(userId);
}

// ----- last-read persistence -------------------------------------------------

function loadLastReadMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LASTREAD_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLastRead(channelId: string, ts: number): void {
  try {
    const map = loadLastReadMap();
    map[channelId] = ts;
    const keys = Object.keys(map);
    if (keys.length > LASTREAD_MAX_ENTRIES) {
      // Drop the stalest watermarks; a re-visit just re-initializes to "caught up".
      keys.sort((a, b) => map[a] - map[b])
        .slice(0, keys.length - LASTREAD_MAX_ENTRIES)
        .forEach((k) => delete map[k]);
    }
    localStorage.setItem(LASTREAD_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable; unread just resets next session
  }
}

// ----- helpers ----------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mentionsMe(text: string, login: string): boolean {
  if (!login || !text) return false;
  return new RegExp(`(^|[^\\w])@${escapeRegex(login)}([^\\w]|$)`, 'i').test(text);
}

function isReading(room: ManagedRoom): boolean {
  return room.viewing && windowFocused;
}

/** Mark everything in the room as seen and zero the counters. */
export function markRead(channelId: string): void {
  let newestTs = 0;
  store().updateSession(channelId, (s) => {
    const last = s.messages[s.messages.length - 1];
    newestTs = Math.max(s.lastReadTs, last?.ts ?? 0);
    return { lastReadTs: newestTs, unread: 0, mentions: 0 };
  });
  if (newestTs > 0) saveLastRead(channelId, newestTs);
}

// ----- lifecycle ---------------------------------------------------------------

/** Connect (or add a reference to) the room for a channel. */
export function ensureRoom(channelId: string): void {
  if (!channelId) return;
  const existing = rooms.get(channelId);
  if (existing) {
    existing.refs += 1;
    return;
  }
  openRoom(channelId, 1);
}

function openRoom(channelId: string, refs: number): void {
  const lastRead = loadLastReadMap()[channelId] ?? 0;
  store().putSession(emptySession(channelId, lastRead));

  let ctrl: ModRoomController | null = null;
  ctrl = connectModRoom(channelId, {
    onState: (state) => {
      store().updateSession(channelId, () => ({ state }));
      const room = rooms.get(channelId);
      if (state === 'connected' && room) room.ctrl.sendFocus(isReading(room));
    },
    onIdentity: ({ userId, login }) =>
      store().updateSession(channelId, () => ({ myUserId: userId, myLogin: login })),
    onKey: (b64) => {
      importRoomKey(b64)
        .then((key) => {
          store().updateSession(channelId, (s) => {
            // A corrected key re-arms messages that failed under the old one.
            const decrypted: Record<string, ResolvedPayload | null> = {};
            for (const [id, v] of Object.entries(s.decrypted)) {
              if (v !== null) decrypted[id] = v;
            }
            return { key, decrypted };
          });
          void processDecrypts(channelId);
        })
        .catch(() => store().updateSession(channelId, () => ({ key: null })));
    },
    onHistory: (msgs) => {
      msgs.forEach((m) => ensureUser(m.userId, m.login));
      store().updateSession(channelId, (s) => {
        // First-ever visit: initialize the watermark to "caught up" so a room
        // you just joined does not open with 50 unread.
        let lastReadTs = s.lastReadTs;
        if (lastReadTs === 0 && msgs.length > 0) {
          lastReadTs = msgs[msgs.length - 1].ts;
          saveLastRead(channelId, lastReadTs);
        }
        // A history replace (reconnect) must not drop optimistic sends still
        // awaiting their echo; re-append them after the server's list.
        const locals = s.messages.filter((m) => s.pending[m.id]);
        const messages = [...msgs, ...locals].slice(-MESSAGE_CAP);
        // Prune decrypted entries for messages that no longer exist.
        const keep = new Set(messages.map((m) => m.id));
        const decrypted: Record<string, ResolvedPayload | null> = {};
        for (const [id, v] of Object.entries(s.decrypted)) {
          if (keep.has(id)) decrypted[id] = v;
        }
        const room = rooms.get(channelId);
        const unread = room && isReading(room)
          ? 0
          : msgs.filter((m) => m.ts > lastReadTs && m.userId !== s.myUserId).length;
        return { messages, decrypted, hasLoaded: true, lastReadTs, unread };
      });
      const room = rooms.get(channelId);
      if (room && isReading(room)) markRead(channelId);
      void processDecrypts(channelId);
    },
    onChat: (mm) => {
      ensureUser(mm.userId, mm.login);
      const room = rooms.get(channelId);
      let readNow = false;
      store().updateSession(channelId, (s) => {
        if (s.messages.some((x) => x.id === mm.id)) return {};
        const messages = [...s.messages, mm].slice(-MESSAGE_CAP);
        if (room && isReading(room)) {
          readNow = true;
          return { messages, lastReadTs: Math.max(s.lastReadTs, mm.ts) };
        }
        const unread = mm.userId && mm.userId !== s.myUserId ? s.unread + 1 : s.unread;
        return { messages, unread };
      });
      if (readNow) saveLastRead(channelId, mm.ts);
      void processDecrypts(channelId);
    },
    onEdit: (id, body, editedAt) => {
      store().updateSession(channelId, (s) => {
        const decrypted = { ...s.decrypted };
        delete decrypted[id];
        return {
          messages: s.messages.map((m) => (m.id === id ? { ...m, body, editedAt } : m)),
          decrypted,
        };
      });
      void processDecrypts(channelId);
    },
    onPresence: (members) => {
      members.forEach((m) => ensureUser(m.userId, m.login));
      store().updateSession(channelId, () => ({ members }));
    },
    onTyping: ({ userId, login }) => {
      const now = Date.now();
      store().updateSession(channelId, (s) => {
        const typingUsers: typeof s.typingUsers = {};
        for (const [id, v] of Object.entries(s.typingUsers)) {
          if (now - v.at < TYPING_TTL_MS) typingUsers[id] = v;
        }
        typingUsers[userId] = { login, at: now };
        return { typingUsers };
      });
    },
    onDenied: (denial) => store().updateSession(channelId, () => ({ denial })),
  });

  rooms.set(channelId, { refs, ctrl, viewing: false });
}

/** Drop a reference; the last release closes the connection. */
export function releaseRoom(channelId: string): void {
  const room = rooms.get(channelId);
  if (!room) return;
  room.refs -= 1;
  if (room.refs > 0) return;
  rooms.delete(channelId);
  room.ctrl.close();
  store().removeSession(channelId);
}

/** Tear down and reconnect (error Retry, or right after the consent lands). */
export function retryRoom(channelId: string): void {
  const room = rooms.get(channelId);
  if (!room) return;
  const { refs, viewing } = room;
  room.ctrl.close();
  rooms.delete(channelId);
  openRoom(channelId, refs);
  const reopened = rooms.get(channelId);
  if (reopened) reopened.viewing = viewing;
}

/** The pane reports whether this channel's room is the visible view. */
export function setViewing(channelId: string, viewing: boolean): void {
  const room = rooms.get(channelId);
  if (!room || room.viewing === viewing) return;
  room.viewing = viewing;
  room.ctrl.sendFocus(isReading(room));
  if (isReading(room)) {
    // Snapshot the divider BEFORE marking read, so "New" points at the right spot.
    store().updateSession(channelId, (s) => ({ dividerTs: s.lastReadTs }));
    markRead(channelId);
  }
}

// ----- decrypt pipeline ---------------------------------------------------------

async function processDecrypts(channelId: string): Promise<void> {
  const s = store().sessions[channelId];
  if (!s?.key) return;
  const todo = s.messages.filter(
    (m) => isEncrypted(m.body) && s.decrypted[m.id] === undefined && !decryptInFlight.has(`${channelId}:${m.id}`),
  );
  if (todo.length === 0) return;
  todo.forEach((m) => decryptInFlight.add(`${channelId}:${m.id}`));

  const updates: Record<string, ResolvedPayload | null> = {};
  for (const m of todo) {
    const pt = await decryptText(s.key, m.body);
    if (pt === null) {
      updates[m.id] = null;
      continue;
    }
    try {
      const obj = JSON.parse(pt) as ResolvedPayload & { x?: string; a?: string };
      updates[m.id] = {
        text: (obj as { x?: string }).x ?? '',
        attachment: (obj as { a?: string }).a,
        reply: (obj as { r?: ResolvedPayload['reply'] }).r,
        emotes: (obj as { e?: ResolvedPayload['emotes'] }).e,
        n: obj.n,
      };
    } catch {
      updates[m.id] = { text: pt };
    }
  }
  todo.forEach((m) => decryptInFlight.delete(`${channelId}:${m.id}`));

  const room = rooms.get(channelId);
  let readTs = 0;
  store().updateSession(channelId, (cur) => {
    let { mentions, unread, lastReadTs } = cur;
    let messages = cur.messages;
    const decrypted = { ...cur.decrypted, ...updates };
    const pending = { ...cur.pending };

    for (const m of todo) {
      const payload = updates[m.id];
      if (!payload) continue;
      // Optimistic reconcile: the echo of an own send replaces its local twin.
      if (payload.n && m.userId === cur.myUserId) {
        const localId = `local-${payload.n}`;
        if (pending[localId]) {
          delete pending[localId];
          delete decrypted[localId];
          messages = messages.filter((x) => x.id !== localId);
        }
        continue;
      }
      // Mention detection (only for messages still unseen).
      if (m.userId !== cur.myUserId && m.ts > lastReadTs && mentionsMe(payload.text, cur.myLogin)) {
        mentions += 1;
      }
    }

    if (room && isReading(room)) {
      const last = messages[messages.length - 1];
      readTs = Math.max(lastReadTs, last?.ts ?? 0);
      lastReadTs = readTs;
      unread = 0;
      mentions = 0;
    }
    return { decrypted, pending, messages, mentions, unread, lastReadTs };
  });
  if (readTs > 0) saveLastRead(channelId, readTs);
}

// ----- actions (pane -> room) ----------------------------------------------------

/** Append an optimistic local message and send its ciphertext. */
export function sendOptimistic(channelId: string, token: string, resolved: ResolvedPayload): void {
  const room = rooms.get(channelId);
  const s = store().sessions[channelId];
  if (!room || !s || !resolved.n) return;
  const localId = `local-${resolved.n}`;
  const selfRole = s.members.find((m) => m.userId === s.myUserId)?.role ?? 'moderator';
  const local: ModRoomChat = {
    id: localId,
    ts: Date.now(),
    userId: s.myUserId,
    login: s.myLogin,
    role: selfRole,
    body: token,
  };
  store().updateSession(channelId, (cur) => ({
    messages: [...cur.messages, local].slice(-MESSAGE_CAP),
    decrypted: { ...cur.decrypted, [localId]: resolved },
    pending: { ...cur.pending, [localId]: { token, nonce: resolved.n!, addedAt: Date.now() } },
  }));
  room.ctrl.send(token);
  armPendingTimeout(channelId, localId);
}

function armPendingTimeout(channelId: string, localId: string): void {
  setTimeout(() => {
    store().updateSession(channelId, (cur) => {
      const entry = cur.pending[localId];
      if (!entry || entry.failed) return {};
      return { pending: { ...cur.pending, [localId]: { ...entry, failed: true } } };
    });
  }, PENDING_TIMEOUT_MS);
}

/** Re-send a failed optimistic message. */
export function retryPending(channelId: string, localId: string): void {
  const room = rooms.get(channelId);
  const s = store().sessions[channelId];
  const entry = s?.pending[localId];
  if (!room || !entry) return;
  store().updateSession(channelId, (cur) => ({
    pending: { ...cur.pending, [localId]: { ...entry, addedAt: Date.now(), failed: false } },
  }));
  room.ctrl.send(entry.token);
  armPendingTimeout(channelId, localId);
}

/** Give up on a failed optimistic message (the pane restores it to the draft). */
export function discardPending(channelId: string, localId: string): void {
  store().updateSession(channelId, (cur) => {
    const pending = { ...cur.pending };
    const decrypted = { ...cur.decrypted };
    delete pending[localId];
    delete decrypted[localId];
    return { pending, decrypted, messages: cur.messages.filter((m) => m.id !== localId) };
  });
}

export function sendEdit(channelId: string, id: string, token: string): void {
  rooms.get(channelId)?.ctrl.edit(id, token);
}

export function sendTyping(channelId: string): void {
  rooms.get(channelId)?.ctrl.sendTyping();
}

export function uploadAttachment(channelId: string, body: BodyInit, contentType: string): Promise<string> {
  const room = rooms.get(channelId);
  if (!room) return Promise.reject(new Error('room not connected'));
  return room.ctrl.upload(body, contentType);
}

// ----- window focus ---------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    windowFocused = true;
    for (const [channelId, room] of rooms) {
      room.ctrl.sendFocus(isReading(room));
      if (isReading(room)) markRead(channelId);
    }
  });
  window.addEventListener('blur', () => {
    windowFocused = false;
    for (const room of rooms.values()) room.ctrl.sendFocus(false);
  });
}
