// Repeat detection for chat. Two or more people posting the same thing in a
// short window is the single noisiest pattern in a big chat, so we fold the
// run into one row carrying a count instead of N identical rows.
//
// Matching is CROSS-USER on purpose: the point is "30 people said LULW", not
// "one person said it twice" (Twitch's own duplicate filter already handles
// that). Emote-only messages are counted too — they're the main case.
//
// Everything here runs on every incoming message, so it stays allocation-light
// and O(1) per call. No regex compilation per message, no fuzzy distance.

import type { RepeatMatchMode } from '../types';

/** Longest normalized key we'll retain. Twitch caps messages at 500 chars;
 *  anything longer than this is unique enough that truncating can't collide
 *  meaningfully, and it bounds the memory the recent-run map can hold. */
const MAX_KEY_LENGTH = 200;

/**
 * Reduce a message to the key two "same" messages must share.
 *
 * `exact` only trims, so casing and spacing differences count as different
 * messages. `normalized` (the default) also folds case, collapses runs of
 * whitespace, and drops trailing punctuation, so "LULW", "lulw" and "LULW!!"
 * all land in the same run.
 *
 * Returns null when the message shouldn't take part in a run at all.
 */
export function normalizeForRepeat(content: string, mode: RepeatMatchMode = 'normalized'): string | null {
  if (!content) return null;
  let s = content.trim();
  if (!s) return null;
  // Slash commands are actions, not conversation, and two people running the
  // same command isn't a repeat worth folding.
  if (s.startsWith('/')) return null;

  if (mode === 'normalized') {
    s = s.toLowerCase().replace(/\s+/g, ' ').replace(/[!?.,~]+$/, '').trim();
    if (!s) return null;
  }

  return s.length > MAX_KEY_LENGTH ? s.slice(0, MAX_KEY_LENGTH) : s;
}

/**
 * Whether a chatter's badges should keep their message out of a run.
 *
 * Broadcaster, moderator and VIP messages are the ones you most need to read
 * verbatim, and folding a mod's message into someone else's row would hide who
 * actually said it.
 *
 * `badges` is the IRC badges tag shape already carried on every message.
 */
export function isPrivilegedChatter(
  badges: Array<{ name: string }> | undefined | null,
): boolean {
  if (!Array.isArray(badges) || badges.length === 0) return false;
  return badges.some(
    (b) => b.name === 'broadcaster' || b.name === 'moderator' || b.name === 'vip',
  );
}
