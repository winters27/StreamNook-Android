// Argument resolution for /pin.
//
// Two shapes, matching how people actually reach for it:
//   /pin <message id> [duration]   pin a specific message
//   /pin @user | user [duration]   pin that person's most recent message
//
// A send-and-pin form is deliberately left out. It needs the id of the message
// you just sent, and while the Helix send path does return one, sendChannelMessage
// currently discards it (Promise<void>). Threading it back is a change to the
// hottest path in the app, so it is deliberately left out rather than shipped
// as a form that always fails.

import { useChatConnectionStore } from '../stores/chatConnectionStore';

export interface PinTarget {
  messageId: string;
  /** null = pin until manually removed, which is Twitch's default. */
  durationSeconds: number | null;
}

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600 };

/** "60", "60s", "5m", "1h" -> seconds. null when it isn't a duration at all. */
function parseDuration(token: string | undefined): number | null {
  if (!token) return null;
  const m = token.match(/^(\d+)([smh])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * (m[2] ? UNITS[m[2]] : 1);
}

/** Twitch message ids are UUIDs; anything else is a name or free text. */
function looksLikeMessageId(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}

/** Most recent message from a login in the local buffer, newest first. */
function latestMessageIdFrom(channel: string, login: string): string | null {
  const slice = useChatConnectionStore.getState().channels.get(channel.toLowerCase());
  if (!slice) return null;
  const wanted = login.replace(/^@/, '').toLowerCase();
  for (let i = slice.messages.length - 1; i >= 0; i--) {
    const m = slice.messages[i];
    if (typeof m === 'string' || !m) continue;
    if (!m.id || !m.username) continue;
    if (m.username.toLowerCase() === wanted) return m.id;
  }
  return null;
}

export function resolvePinTarget(
  channel: string,
  args: string[],
): PinTarget | { error: string } {
  const tokens = args.filter(Boolean);
  if (tokens.length === 0) {
    return { error: '/pin needs a message id or a username' };
  }

  const [first, ...rest] = tokens;

  if (looksLikeMessageId(first)) {
    return { messageId: first, durationSeconds: parseDuration(rest[0]) };
  }

  const found = latestMessageIdFrom(channel, first);
  if (!found) {
    return { error: `No recent message from ${first.replace(/^@/, '')} in this chat` };
  }
  return { messageId: found, durationSeconds: parseDuration(rest[0]) };
}
