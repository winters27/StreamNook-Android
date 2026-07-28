// Per-window mod-room session state, owned by modRoomManager (the only writer)
// and consumed by ModRoomPane + the host toggles/badges. Living OUTSIDE the pane
// is the point: rooms stay connected while the user is on another view, so
// unread counts, mentions, and presence keep working when nothing renders them.

import { create } from 'zustand';
import type { ModRoomChat, ModRoomDenial, ModRoomMember, ModRoomState } from '../services/modRoomService';

/** Decrypted (or legacy plaintext) message payload. */
export interface ResolvedPayload {
  text: string;
  attachment?: string;
  reply?: { id: string; login: string; text: string };
  emotes?: { n: string; id: string; p: string; u: string }[];
  /** Optimistic-send reconcile nonce (travels inside the ciphertext). */
  n?: string;
}

export interface PendingSend {
  /** The encrypted body, kept for retry. */
  token: string;
  nonce: string;
  addedAt: number;
  failed?: boolean;
}

export interface RoomSession {
  channelId: string;
  state: ModRoomState;
  denial: ModRoomDenial | null;
  messages: ModRoomChat[];
  decrypted: Record<string, ResolvedPayload | null>;
  members: ModRoomMember[];
  typingUsers: Record<string, { login: string; at: number }>;
  hasLoaded: boolean;
  myUserId: string;
  myLogin: string;
  /** AES-GCM room key; present only once the gate has verified this user. */
  key: CryptoKey | null;
  unread: number;
  mentions: number;
  /** Newest message ts the user has seen (persisted per channel). */
  lastReadTs: number;
  /** lastReadTs captured when the view was last entered (the "New" divider). */
  dividerTs: number;
  /** Optimistic sends awaiting their server echo, keyed by local message id. */
  pending: Record<string, PendingSend>;
}

export function emptySession(channelId: string, lastReadTs: number): RoomSession {
  return {
    channelId,
    state: 'connecting',
    denial: null,
    messages: [],
    decrypted: {},
    members: [],
    typingUsers: {},
    hasLoaded: false,
    myUserId: '',
    myLogin: '',
    key: null,
    unread: 0,
    mentions: 0,
    lastReadTs,
    dividerTs: lastReadTs,
    pending: {},
  };
}

interface ModRoomStoreState {
  sessions: Record<string, RoomSession>;
  /** Per-channel composer drafts, so toggling views or channels keeps them. */
  drafts: Record<string, string>;
  setDraft: (channelId: string, value: string) => void;
  /** Manager-only: create/replace a session wholesale. */
  putSession: (session: RoomSession) => void;
  /** Manager-only: apply a partial update to an existing session. */
  updateSession: (channelId: string, update: (s: RoomSession) => Partial<RoomSession>) => void;
  removeSession: (channelId: string) => void;
}

export const useModRoomStore = create<ModRoomStoreState>((set) => ({
  sessions: {},
  drafts: {},
  setDraft: (channelId, value) =>
    set((st) => ({ drafts: { ...st.drafts, [channelId]: value } })),
  putSession: (session) =>
    set((st) => ({ sessions: { ...st.sessions, [session.channelId]: session } })),
  updateSession: (channelId, update) =>
    set((st) => {
      const cur = st.sessions[channelId];
      if (!cur) return st;
      return { sessions: { ...st.sessions, [channelId]: { ...cur, ...update(cur) } } };
    }),
  removeSession: (channelId) =>
    set((st) => {
      if (!st.sessions[channelId]) return st;
      const sessions = { ...st.sessions };
      delete sessions[channelId];
      return { sessions };
    }),
}));
