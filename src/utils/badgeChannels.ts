// Finds the Twitch channels a badge's earn text points at, so the More Info
// panel can render them as clickable chips and cards.
//
// Badge copy names a channel in several ways and rarely as a bare login:
// "/studbudz", "twitch.tv/fps_shaka", "Ibai's channel", "the participating
// channel StudBudz". Scraped copy also uses the curly apostrophe, so the
// possessive form must accept both.
//
// Callers resolve every candidate through `search_channels` and drop the ones
// that do not exist, so this errs toward offering candidates rather than
// filtering hard here.

// Words that follow "channel" or sit in a possessive without naming a streamer.
const NOT_A_CHANNEL = new Set([
  'twitch', 'the', 'this', 'that', 'these', 'those', 'any', 'all', 'each', 'one', 'both',
  'a', 'an', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'from', 'with', 'via', 'by',
  'you', 'your', 'their', 'his', 'her', 'its', 'our', 'my',
  'participating', 'eligible', 'partner', 'partnered', 'affiliate', 'selected', 'select',
  'specific', 'certain', 'multiple', 'single', 'other', 'another', 'following', 'listed',
  'live', 'stream', 'streams', 'streamer', 'streamers', 'channel', 'channels', 'category',
  'categories', 'directory', 'event', 'events', 'badge', 'badges', 'campaign', 'drops', 'drop',
  'during', 'while', 'when', 'must', 'need', 'watch', 'watching', 'subscribe', 'subscription',
  'gift', 'gifted', 'gifting', 'viewers', 'viewer', 'users', 'user', 'source', 'note', 'notes',
  'important', 'however', 'also', 'prime', 'turbo', 'access', 'games', 'game', 'special',
  'official', 'main', 'new', 'first', 'second', 'third', 'games',
]);

// Twitch logins: 4 to 25 characters, letters/digits/underscore, not starting with a digit.
const LOGIN = /^[a-zA-Z][a-zA-Z0-9_]{3,24}$/;

function accept(raw: string, into: Set<string>): void {
  const name = raw.trim();
  if (!LOGIN.test(name)) return;
  if (NOT_A_CHANNEL.has(name.toLowerCase())) return;
  into.add(name.toLowerCase());
}

/**
 * Channel logins referenced by badge text, lowercased and deduped.
 * Order is the order they appear.
 */
export function extractChannelLogins(text: string): string[] {
  const found = new Set<string>();
  if (!text) return [];

  // "twitch.tv/fps_shaka", including the "either of the following channels" list.
  for (const m of text.matchAll(/twitch\.tv\/([a-zA-Z][a-zA-Z0-9_]{3,24})\b/gi)) {
    // Skip the site's own routes, which are not channels.
    if (/^(directory|videos|settings|drops|turbo|prime|subscriptions|downloads|jobs|about|legal|help|store)$/i.test(m[1])) continue;
    accept(m[1], found);
  }

  // A bare "/studbudz" mention, not preceded by a word character or another slash
  // so it cannot swallow the tail of a URL path.
  for (const m of text.matchAll(/(?:^|[^\w/.])\/([a-zA-Z][a-zA-Z0-9_]{3,24})\b/g)) {
    accept(m[1], found);
  }

  // "Ibai's channel", "JasonTheWeen’s 7 day survival". Scraped copy uses the
  // curly apostrophe far more often than the straight one.
  for (const m of text.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]{3,24})['’]s\s+(?:twitch\s+)?(?:channel|stream)\b/gi)) {
    accept(m[1], found);
  }

  // "the participating channel StudBudz", "channels Foo and Bar", "channel: Baz".
  //
  // Prose writes a handle capitalised, so requiring a capital keeps ordinary
  // sentences out ("any channel outside this category", "channels include").
  // A following capitalised word means a multi-word display name rather than a
  // login ("channels include: Riot Games"), which cannot be resolved anyway.
  const NAME = String.raw`[A-Z][A-Za-z0-9_]{3,24}`;
  for (const m of text.matchAll(
    new RegExp(`\\bchannels?\\b[:\\s]+(?:named\\s+|called\\s+)?(${NAME}(?:\\s*(?:,|and|&)\\s*${NAME})*)(?!\\s+[A-Z])`, 'g')
  )) {
    for (const part of m[1].split(/\s*(?:,|and|&)\s*/)) accept(part, found);
  }

  return [...found];
}
