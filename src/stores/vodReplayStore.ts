// VOD chat replay engine: historical Twitch chat synced to VOD playback.
//
// VODs have no live IRC feed. The backend `get_vod_comments` command fetches a
// VOD's recorded chat (Twitch's own VideoComments GQL) and returns each comment
// already parsed into the same shape live chat uses. This store drips those
// comments into the chat panel as the player's playhead passes each comment's
// offset, so ChatWidget renders replay through its existing message path.
//
// The reactive surface is tiny (`messages` + a `version` counter); the buffer,
// pointer, and timers live in module scope so ticking never forces a React
// render unless the visible list actually changed.

import { create } from 'zustand';
import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getPlayerControls } from '../keybindings/playerControls';
import type { BackendChatMessage } from '../services/twitchChat';
import { EMPTY_ROOM_STATE } from './chatConnectionStore';
import { Logger } from '../utils/logger';

interface VodComment {
  content_offset_seconds: number;
  message: BackendChatMessage;
}

const VISIBLE_MAX = 200; // rendered-message cap (headroom for scroll-back)
const TICK_MS = 750; // playhead poll interval
// Any real rewind counts. Normal playback only ever moves the playhead forward, so
// anything backward past a hair of jitter is the viewer scrubbing, and scrubbing back
// must take those messages off screen again. Kept small deliberately: the recompute it
// triggers is served from the buffer with no network, so being sensitive costs nothing.
const SEEK_BACK_S = 0.75;
const SEEK_FWD_S = 20; // forward jump beyond this = a seek, re-sync
const BACKLOG_LEAD_S = 15; // seed/seek fetch starts this far before the playhead
const REFILL_WITHIN = 40; // refill when fewer than this many buffered comments remain
const SEEK_SETTLE_MS = 400; // wait for scrubbing to settle before re-fetching

interface ReplayStore {
  /** True while a VOD replay session is active (drives ChatWidget's toggle availability). */
  active: boolean;
  /** Bumped on each `beginVodReplay` — ChatWidget resets its replay/live toggle to
   *  replay when this changes, so a new VOD always starts in replay. */
  sessionId: number;
  /** Bumped whenever `messages` changes — ChatWidget's list memo keys off this. */
  version: number;
  messages: BackendChatMessage[];
  error: string | null;
}

export const useVodReplayStore = create<ReplayStore>(() => ({
  active: false,
  sessionId: 0,
  version: 0,
  messages: [],
  error: null,
}));

// --- engine state (module-scoped, non-reactive) -----------------------------
let vodId: string | null = null;
let channelLogin: string | null = null;
let buffer: VodComment[] = []; // sorted ascending by offset
let ptr = 0; // index of the next not-yet-shown comment in `buffer`
let visible: BackendChatMessage[] = [];
const seen = new Set<string>(); // comment ids already buffered (dedup same-second overlap)
let lastTime = 0; // previous tick's playhead position
let fetching = false; // single in-flight fetch guard (kills scrub-thrash)
let nextFetchOffset = 0; // offset requested by the next refill
let reachedFrontier = false; // last fetch added nothing new — pause refills until playhead moves on
let ticker: ReturnType<typeof setInterval> | null = null;
let seekTimer: ReturnType<typeof setTimeout> | null = null;
// A CLIP replays a WINDOW of its source VOD: its own player clock starts at 0, but the
// comments live at `startOffset` into the VOD. So every comparison against a comment's
// content_offset_seconds runs in VOD time, never player time. A VOD replay leaves these
// at their defaults, which makes the whole mapping an exact no-op.
let startOffset = 0;
let endOffset = Number.POSITIVE_INFINITY;
// Where to read the playhead. Null = the main player. A clip playing in ClipModal's own
// <video> passes a reader instead, because registerPlayerControls is a single-slot global
// owned by VideoPlayer and a second registrant would clobber it on unmount.
let timeSource: (() => number | null) | null = null;

/** Playhead in PLAYER time (0 = start of whatever is playing), or null if unavailable. */
function playerTime(): number | null {
  const t = timeSource ? timeSource() : (getPlayerControls()?.getCurrentTime() ?? null);
  return t == null || Number.isNaN(t) ? null : t;
}

/** Player clock -> source-VOD clock. Identity for a VOD, shifted for a clip. */
function vodTime(t: number): number {
  return t + startOffset;
}

function publish(messages: BackendChatMessage[], error: string | null = null): void {
  useVodReplayStore.setState((s) => ({ messages, error, version: s.version + 1 }));
}

async function fetchAt(offset: number): Promise<void> {
  if (fetching || !vodId || !channelLogin) return;
  fetching = true;
  const requestVod = vodId;
  try {
    const page = await invoke<VodComment[]>('get_vod_comments', {
      videoId: vodId,
      channelLogin,
      offsetSeconds: Math.max(startOffset, offset),
    });
    // A stop()/begin() may have swapped the session while we awaited.
    if (vodId !== requestVod) return;

    let added = 0;
    let maxOffset = nextFetchOffset;
    for (const c of page) {
      if (!c.message || seen.has(c.message.id)) continue;
      seen.add(c.message.id);
      buffer.push(c);
      added++;
      if (c.content_offset_seconds > maxOffset) maxOffset = c.content_offset_seconds;
    }
    if (added > 0) {
      // Refills always fetch at/after the last offset we hold, so new comments
      // land at the tail; sorting keeps ascending order without disturbing the
      // already-emitted head (ptr stays valid).
      buffer.sort((a, b) => a.content_offset_seconds - b.content_offset_seconds);
    }
    nextFetchOffset = maxOffset;
    reachedFrontier = added === 0; // only-seen/empty ⇒ at the live frontier of buffered data
    if (useVodReplayStore.getState().error) publish(visible.slice()); // clear a prior error
  } catch (e) {
    Logger.warn('[VodReplay] get_vod_comments failed:', e);
    useVodReplayStore.setState((s) => ({ ...s, error: 'Could not load chat replay' }));
  } finally {
    fetching = false;
  }
}

function scheduleSeekResync(): void {
  if (seekTimer) clearTimeout(seekTimer);
  seekTimer = setTimeout(() => {
    seekTimer = null;
    const now = playerTime() ?? lastTime;
    buffer = [];
    ptr = 0;
    visible = [];
    seen.clear();
    reachedFrontier = false;
    nextFetchOffset = Math.max(startOffset, vodTime(now) - BACKLOG_LEAD_S);
    publish([]);
    void fetchAt(nextFetchOffset);
  }, SEEK_SETTLE_MS);
}

/** Re-derive the visible list from the buffer for an arbitrary position.
 *
 *  This is what makes scrubbing exact: rewinding 5 s genuinely takes those 5 s of chat
 *  back off the screen, immediately, instead of leaving them stranded until a debounced
 *  refetch lands. It rewinds `ptr` and replays the buffer rather than mutating it, so
 *  `seen` stays valid and nothing is refetched.
 *
 *  Returns false when the buffer cannot answer — a rewind to before the earliest comment
 *  we hold — so the caller can fall back to the network resync. */
function reseekFromBuffer(vt: number): boolean {
  if (!buffer.length) return false;
  if (vt < buffer[0].content_offset_seconds - 1) return false;
  ptr = 0;
  visible = [];
  while (ptr < buffer.length && buffer[ptr].content_offset_seconds <= vt) {
    visible.push(buffer[ptr].message);
    ptr++;
  }
  if (visible.length > VISIBLE_MAX) visible = visible.slice(-VISIBLE_MAX);
  publish(visible.slice());
  return true;
}

function tick(): void {
  const t = playerTime();
  if (t == null) return; // player not mounted yet (R2)

  // Seek detection is purely positional — no Plyr event wiring needed.
  if (t < lastTime - SEEK_BACK_S || t > lastTime + SEEK_FWD_S) {
    lastTime = t;
    // Serve the seek from what we already hold whenever possible. For a clip the whole
    // window is buffered, so every scrub inside it resolves instantly with no blank gap.
    if (reseekFromBuffer(vodTime(t))) {
      if (seekTimer) {
        clearTimeout(seekTimer);
        seekTimer = null;
      }
      return;
    }
    scheduleSeekResync();
    return;
  }
  lastTime = t;
  if (seekTimer) return; // mid-seek settle: hold emissions until the resync fires

  let emitted = false;
  const vt = vodTime(t);
  while (ptr < buffer.length && buffer[ptr].content_offset_seconds <= vt) {
    visible.push(buffer[ptr].message);
    ptr++;
    emitted = true;
  }
  if (emitted) {
    if (visible.length > VISIBLE_MAX) visible = visible.slice(-VISIBLE_MAX);
    publish(visible.slice()); // fresh ref so the list memo re-renders
  }

  // Keep the buffer ahead of the playhead. Both refill paths stop at `endOffset`, which
  // is Infinity for a VOD and the clip's end for a clip. Bounding only the first one
  // would leave the frontier fallback below refetching on every tick once a clip's
  // window is exhausted, because `reachedFrontier` flips true and stays true.
  const withinWindow = nextFetchOffset < endOffset;
  if (!fetching && withinWindow && !reachedFrontier && buffer.length - ptr < REFILL_WITHIN) {
    void fetchAt(nextFetchOffset);
  } else if (!fetching && withinWindow && reachedFrontier && ptr >= buffer.length && vt > nextFetchOffset + 1) {
    // We'd drained everything and the last fetch was empty, but the playhead has
    // since moved past that frontier — try again from the current position.
    reachedFrontier = false;
    void fetchAt(Math.floor(vt));
  }
}

/** The source-VOD window to replay for a clip. Both the main player and the clip modal
 *  go through this so they cannot drift apart.
 *
 *  There is NO offset correction here, and that is a measured decision, not an omission.
 *  Twitch anchors a clip's chat replay at exactly `videoOffsetSeconds`: on the clip
 *  `ArtisticFreezingPepperoniNononoCat` (summit1g, reported offset 2781) Twitch's own
 *  page opens with `Ban119: LUL`, and that comment's `contentOffsetSeconds` is 2781 —
 *  delta exactly 0.
 *
 *  A previous version subtracted 15 s here, on the theory that the chat reaction spike
 *  sitting ~9 s before the reported start meant the offset ran late. That was a
 *  misreading: a clip is normally cut to START on the reaction, so the burst legitimately
 *  begins at frame one. Do not reintroduce a correction without ground truth of that
 *  form (a named chatter at a known position on Twitch's own clip page). */
export function clipReplayWindow(
  vodOffset: number,
  durationSeconds?: number,
): { startOffset: number; endOffset: number } {
  return { startOffset: Math.max(0, vodOffset), endOffset: vodOffset + (durationSeconds ?? 60) };
}

/** What a replay session needs to be recreated. See `snapshotReplaySession`. */
export interface ReplaySession {
  id: string;
  login: string;
  startOffset: number;
  endOffset: number;
}

export interface BeginReplayOptions {
  /** Seconds into the source VOD where a clip begins. Omit for a VOD (0). */
  startOffset?: number;
  /** Seconds into the source VOD where a clip ends; refills stop past it. */
  endOffset?: number;
  /** Read the playhead from somewhere other than the main player — a clip playing in
   *  ClipModal's own <video>. Deliberately NOT captured by snapshotReplaySession: only
   *  the modal supplies one, and only the modal restores, so a restored session is
   *  always a main-player session. Capturing it would resurrect a dead element ref. */
  getTime?: () => number | null;
}

/** Start a replay session. `login` keys the channel's third-party emote set for parsing.
 *  Safe to call over an existing session. */
export function beginVodReplay(id: string, login: string, opts?: BeginReplayOptions): void {
  stopVodReplay();
  vodId = id;
  channelLogin = login.toLowerCase();
  buffer = [];
  ptr = 0;
  visible = [];
  seen.clear();
  fetching = false;
  reachedFrontier = false;
  startOffset = Math.max(0, opts?.startOffset ?? 0);
  endOffset = opts?.endOffset ?? Number.POSITIVE_INFINITY;
  timeSource = opts?.getTime ?? null;
  const t = playerTime() ?? 0;
  lastTime = t; // avoid a spurious first-tick seek on resume
  nextFetchOffset = Math.max(startOffset, vodTime(lastTime) - BACKLOG_LEAD_S);
  useVodReplayStore.setState((s) => ({
    active: true,
    sessionId: s.sessionId + 1,
    version: 0,
    messages: [],
    error: null,
  }));
  void fetchAt(nextFetchOffset);
  ticker = setInterval(tick, TICK_MS);
}

/** Force an immediate sync to the current playhead — e.g. when the viewer
 *  toggles back to replay from live chat. The engine keeps running in the
 *  background across a live/replay toggle, so this only catches up instantly
 *  instead of waiting for the next poll; it never clears or resets position. */
export function nudgeVodReplay(): void {
  tick();
}

/** Tear down the active replay session (called on stopStream / VOD swap). */
export function stopVodReplay(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  if (seekTimer) {
    clearTimeout(seekTimer);
    seekTimer = null;
  }
  vodId = null;
  channelLogin = null;
  buffer = [];
  ptr = 0;
  visible = [];
  seen.clear();
  fetching = false;
  reachedFrontier = false;
  // Reset the window too, or a clip's offsets would poison the next VOD replay.
  startOffset = 0;
  endOffset = Number.POSITIVE_INFINITY;
  timeSource = null;
  useVodReplayStore.setState({ active: false, messages: [], error: null });
}

/** The session currently driving replay, or null when nothing is running.
 *
 *  The engine is a module singleton, so a surface that takes it over temporarily — the
 *  clip modal opening on top of a VOD the user is already watching — has to be able to
 *  put back what it interrupted. Without this, closing that modal leaves the VOD playing
 *  with dead chat. */
export function snapshotReplaySession(): ReplaySession | null {
  if (!useVodReplayStore.getState().active || !vodId || !channelLogin) return null;
  return { id: vodId, login: channelLogin, startOffset, endOffset };
}

/** Put back a session captured with `snapshotReplaySession`. Null just stops replay.
 *  Re-seeds from the player's current position, the same way a seek resync does, so the
 *  restored VOD picks up where it now is rather than where it was. */
export function restoreReplaySession(session: ReplaySession | null): void {
  if (!session) {
    stopVodReplay();
    return;
  }
  beginVodReplay(session.id, session.login, {
    startOffset: session.startOffset,
    endOffset: session.endOffset,
  });
}

const NOOP = async (): Promise<void> => {};
const EMPTY_SET: Set<string> = new Set();
const EMPTY_MAP = new Map();

/** Chat-source object shaped exactly like `useTwitchChat()` / the provider chat,
 *  so ChatWidget can select it with no other structural change. Read-only:
 *  connect/send are no-ops (you can't post into a recorded stream). */
export function useVodReplaySnapshot() {
  const messages = useVodReplayStore((s) => s.messages);
  const version = useVodReplayStore((s) => s.version);
  const error = useVodReplayStore((s) => s.error);
  return useMemo(
    () => ({
      messages,
      connectChat: NOOP,
      sendMessage: NOOP,
      isConnected: true,
      error,
      setPaused: () => {},
      deletedMessageIds: EMPTY_SET,
      clearedUserContexts: EMPTY_MAP,
      roomState: { ...EMPTY_ROOM_STATE },
      userBadges: null,
      liveMessageCount: version,
      // Re-render signal for the memoized message list, same contract as
      // ChannelChatSnapshot.renderToken. The replay tick bumps `version`.
      renderToken: version,
    }),
    [messages, version, error],
  );
}
