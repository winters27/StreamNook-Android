import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '../../utils/logger';

// Module-level cache of badge title -> image URL, built once from the global
// badge set so every tiers list doesn't re-fetch.
let titleImageMap: Map<string, string> | null = null;
let titleImagePromise: Promise<Map<string, string>> | null = null;

interface GlobalBadgeVersion {
  title: string;
  image_url_2x: string;
}
interface GlobalBadgeSet {
  versions: GlobalBadgeVersion[];
}

async function getTitleImageMap(): Promise<Map<string, string>> {
  if (titleImageMap) return titleImageMap;
  if (!titleImagePromise) {
    titleImagePromise = (async () => {
      const map = new Map<string, string>();
      try {
        const resp = await invoke<{ data: GlobalBadgeSet[] } | null>('get_cached_global_badges');
        for (const set of resp?.data ?? []) {
          for (const v of set.versions ?? []) {
            if (v.title) map.set(v.title.toLowerCase(), v.image_url_2x);
          }
        }
      } catch (err) {
        Logger.warn('[BadgeSiblingChips] failed to load global badges:', err);
      }
      titleImageMap = map;
      return map;
    })();
  }
  return titleImagePromise;
}

const DISCORD_TOKEN = /<a?:\w+:\d+>/g;
const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

// A short requirement label from a phrase like "watch 3 hours", "1 hour of
// watching", "1 sub". null when there's no recognizable requirement.
function requirementLabel(text: string): string | null {
  const m = text
    .toLowerCase()
    .match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(hour|minute|sub)/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : WORD_NUM[m[1]] ?? 0;
  return `${n} ${m[2]}${n === 1 ? '' : 's'}`;
}

// Split a sibling list (comma list from us, newline list from badgebase) into
// { name, requirement }, stripping Discord emoji + the "— how to earn" suffix.
function parseSiblings(related: string): { name: string; requirement: string }[] {
  return related
    .split(/[\n,]/)
    .map((line) => {
      const clean = line.replace(DISCORD_TOKEN, '').trim();
      const parts = clean.split(/\s+[·—–-]\s+/);
      return { name: parts[0].trim(), requirement: (parts[1] || '').trim() };
    })
    .filter((t) => t.name);
}

// Prefer a parenthetical tier label ("EWC 2026 (Bronze)" -> "Bronze").
function shortLabel(name: string): string {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return (m ? m[1] : name).trim();
}

/** The sibling badge tiers of the same event as a compact list: each tier's real
 *  icon, its label, and its requirement. Icons resolve by full title, and for
 *  short tier labels ("Bronze") by rebuilding the full title from the current
 *  badge's prefix ("EWC 2026 (Gold)" + "Bronze" -> "EWC 2026 (Bronze)"). */
export const BadgeSiblingChips = ({ related, currentTitle }: { related: string; currentTitle?: string }) => {
  const tiers = useMemo(() => parseSiblings(related), [related]);
  const [images, setImages] = useState<Map<string, string>>(() => titleImageMap ?? new Map());

  const prefix = useMemo(() => {
    const m = (currentTitle || '').match(/^(.*?)\s*\([^)]+\)\s*$/);
    return m ? m[1].trim() : '';
  }, [currentTitle]);

  useEffect(() => {
    if (titleImageMap) return;
    let alive = true;
    getTitleImageMap().then((map) => {
      if (alive) setImages(new Map(map));
    });
    return () => {
      alive = false;
    };
  }, []);

  const resolveImage = (name: string): string | undefined => {
    const direct = images.get(name.toLowerCase());
    if (direct) return direct;
    if (prefix) return images.get(`${prefix} (${name})`.toLowerCase());
    return undefined;
  };

  if (!tiers.length) return null;

  return (
    <div className="flex flex-col">
      {tiers.map((t, i) => {
        const img = resolveImage(t.name);
        const req = requirementLabel(t.requirement);
        return (
          <div
            key={i}
            className="flex items-center gap-2.5 py-1.5 border-b border-white/[0.04] last:border-b-0 text-[14px]"
          >
            {img ? (
              <img src={img} alt="" className="w-[22px] h-[22px] rounded-[5px] object-cover shrink-0" />
            ) : (
              <span className="w-[22px] h-[22px] rounded-[5px] bg-white/[0.04] shrink-0" />
            )}
            <span className="flex-1 text-textPrimary truncate">{shortLabel(t.name)}</span>
            {req && <span className="text-textSecondary text-[13px] shrink-0">{req}</span>}
          </div>
        );
      })}
    </div>
  );
};
