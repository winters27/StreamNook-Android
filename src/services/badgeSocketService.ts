// Badge-drop feed client. Holds a WebSocket to the Cloudflare relay
// (modroom.streamnook.app/badges), with the edge-cached latest.json as a poll
// fallback and a catch-up read on startup.
//
// Transport only: every drop is forwarded to the Rust `ingest_badge_drops`
// command, which owns the notify-vs-store decision and its persistence.

import { invoke } from '@tauri-apps/api/core';
import { Logger } from '../utils/logger';

const WS_URL = 'wss://modroom.streamnook.app/badges';
const LATEST_URL = 'https://modroom.streamnook.app/badges/latest.json';
// Reconcile net while the socket is up; latest.json is edge-cached, so cheap.
const POLL_INTERVAL_MS = 15 * 60_000;
// Faster cadence while the socket is down and polling is the only path.
const OFFLINE_POLL_INTERVAL_MS = 120_000;
const RECONNECT_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000];
const PING_INTERVAL_MS = 30_000;
// The relay auto-answers `ping` with `pong`, so silence this long means a
// half-open socket: alive locally, delivering nothing, never fires onclose.
const LIVENESS_TIMEOUT_MS = 90_000;

interface BadgePayload {
  badge_name: string;
  badge_set_id: string;
  badge_version: string;
  badge_image_url: string;
  badge_description?: string;
  status: 'new' | 'available' | 'coming_soon';
  date_info?: string;
  enrichment?: Record<string, unknown>;
}

interface Drop {
  id: string;
  ts: number;
  badge: BadgePayload;
}

let started = false;
let closed = false;
let ws: WebSocket | null = null;
let backoffIndex = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let lastInboundAt = 0;

/** Hand a batch of drops to the backend, which decides what to surface. */
async function ingest(drops: Drop[]): Promise<void> {
  const badges = drops.map((d) => d?.badge).filter(Boolean);
  if (!badges.length) return;
  try {
    await invoke('ingest_badge_drops', { badges });
  } catch (e) {
    Logger.error('[BadgeSocket] ingest_badge_drops failed:', e);
  }
}

function handleMessage(ev: MessageEvent): void {
  lastInboundAt = Date.now();
  const raw = ev.data as string;
  // Heartbeat reply from the relay's auto-response; not JSON.
  if (raw === 'pong') return;

  let data: { t?: string; drops?: Drop[]; id?: string; ts?: number; badge?: BadgePayload };
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (data.t === 'history') {
    void ingest(data.drops ?? []);
  } else if (data.t === 'drop' && data.id && data.badge) {
    void ingest([{ id: data.id, ts: data.ts ?? Date.now(), badge: data.badge }]);
  }
}

async function pollOnce(): Promise<void> {
  try {
    const res = await fetch(LATEST_URL);
    if (!res.ok) return;
    const drops = (await res.json()) as Drop[];
    await ingest(drops);
  } catch {
    // offline or relay down; the next tick retries
  }
}

function startPolling(intervalMs: number): void {
  stopPolling();
  pollTimer = setInterval(() => void pollOnce(), intervalMs);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function stopPinging(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

// Ping on a timer; if the relay goes quiet, close the socket so the onclose
// path restores the faster poll cadence and schedules a reconnect.
function startPinging(socket: WebSocket): void {
  stopPinging();
  lastInboundAt = Date.now();
  pingTimer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastInboundAt > LIVENESS_TIMEOUT_MS) {
      Logger.warn('[BadgeSocket] relay went quiet; recycling the socket');
      try {
        socket.close();
      } catch {
        // already going away
      }
      return;
    }
    try {
      socket.send('ping');
    } catch {
      // send failed; the liveness check will recycle on the next tick
    }
  }, PING_INTERVAL_MS);
}

function scheduleReconnect(): void {
  if (closed || reconnectTimer) return;
  const delay = RECONNECT_BACKOFF_MS[Math.min(backoffIndex, RECONNECT_BACKOFF_MS.length - 1)];
  backoffIndex += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect(): void {
  if (closed) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    if (closed) {
      socket.close();
      return;
    }
    backoffIndex = 0;
    // The socket is the delivery path now, so drop to the slow reconcile poll.
    startPolling(POLL_INTERVAL_MS);
    startPinging(socket);
  };
  socket.onmessage = handleMessage;
  socket.onclose = () => {
    if (ws === socket) ws = null;
    stopPinging();
    if (closed) return;
    // Poll harder while we are without a socket, and keep trying to reconnect.
    startPolling(OFFLINE_POLL_INTERVAL_MS);
    scheduleReconnect();
  };
  socket.onerror = () => {
    // onclose drives recovery; nothing extra needed here.
  };
}

/** Start the badge feed. Idempotent; safe to call once on app startup. */
export function startBadgeFeed(): void {
  if (started) return;
  started = true;
  closed = false;
  // Catches drops that landed while the app was closed, and seeds the gallery
  // and enrichment cache.
  void pollOnce();
  connect();
}

/** Tear down the feed (e.g. on app shutdown). */
export function stopBadgeFeed(): void {
  closed = true;
  started = false;
  stopPolling();
  stopPinging();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}
