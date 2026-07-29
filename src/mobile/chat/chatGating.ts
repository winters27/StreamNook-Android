// Why you might not be able to talk in this room.
//
// Two different kinds of claim here, and they are kept apart deliberately:
//
//   `labels`  - what the room has switched ON. Purely factual, straight off
//               ROOMSTATE, so it is always safe to show.
//   `blocked` - a claim that YOU specifically cannot send. Only asserted where
//               your own badges settle it, because badges are authoritative for
//               the channel you are in. Follower-only is deliberately NOT
//               treated as blocking: nothing in the chat payload says whether
//               you follow, and guessing wrong either hides a working composer
//               or promises one that will silently drop messages.
import type { RoomState } from '../../stores/chatConnectionStore';

export interface ChatGating {
  /** Active restrictions, in the order they should read. Empty when unrestricted. */
  labels: string[];
  /** Set only when your badges prove you cannot send. */
  blocked: 'subs' | 'emote' | null;
  /** One-line explanation for the composer when blocked. */
  reason: string | null;
}

function hasAny(badges: string | null | undefined, names: string[]): boolean {
  if (!badges) return false;
  return names.some((n) => badges.includes(n));
}

/** Elevated roles bypass every chat restriction Twitch applies. */
const ELEVATED = ['broadcaster', 'moderator', 'vip'];

export function deriveChatGating(
  room: RoomState | null | undefined,
  userBadges: string | null | undefined,
): ChatGating {
  if (!room) return { labels: [], blocked: null, reason: null };

  const labels: string[] = [];
  if (room.subsOnly) labels.push('Subscribers only');
  if (room.followersOnly === 0) labels.push('Followers only');
  else if (room.followersOnly > 0) labels.push(`Followers only (${room.followersOnly}m)`);
  if (room.emoteOnly) labels.push('Emote only');
  if (room.slow > 0) labels.push(`Slow ${room.slow}s`);
  if (room.r9k) labels.push('Unique messages only');

  const elevated = hasAny(userBadges, ELEVATED);
  let blocked: ChatGating['blocked'] = null;
  let reason: string | null = null;

  if (!elevated) {
    if (room.subsOnly && !hasAny(userBadges, ['subscriber', 'founder'])) {
      blocked = 'subs';
      reason = 'Subscribers only';
    } else if (room.emoteOnly) {
      // Emote-only blocks free text for everyone unelevated, whether or not you
      // subscribe, so this one needs no badge check beyond the bypass.
      blocked = 'emote';
      reason = 'Emote only. Send emotes from the picker.';
    }
  }

  return { labels, blocked, reason };
}
