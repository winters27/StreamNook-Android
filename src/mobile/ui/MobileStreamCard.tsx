// Touch-native stream card in StreamNook's own card language, matching the
// desktop Home cards: padded glass panel, rounded thumbnail, the canonical
// .live-dot, .drops-badge-glass, .glass-badge viewer chip, partner verified
// mark, and Apple-style emoji titles. Only the sizing is phone-tuned.
import React, { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import StreamTitleWithEmojis from '../../components/StreamTitleWithEmojis';
import type { TwitchStream, DropCampaign } from '../../types';

function thumbUrl(stream: TwitchStream): string {
  return stream.thumbnail_url.replace('{width}', '640').replace('{height}', '360');
}

// Drops-enabled games by lowercase name, shared across every card. Backend
// caches the campaign list (1h), so one invoke per session is plenty.
let dropsNamesCache: Map<string, DropCampaign> | null = null;
let dropsNamesPromise: Promise<Map<string, DropCampaign>> | null = null;

function loadDropsGameNames(): Promise<Map<string, DropCampaign>> {
  if (dropsNamesCache) return Promise.resolve(dropsNamesCache);
  dropsNamesPromise ??= invoke<DropCampaign[]>('get_active_drop_campaigns')
    .then((campaigns) => {
      const map = new Map<string, DropCampaign>();
      for (const campaign of campaigns ?? []) {
        if (campaign.game_name) map.set(campaign.game_name.toLowerCase(), campaign);
      }
      dropsNamesCache = map;
      return map;
    })
    .catch(() => new Map<string, DropCampaign>());
  return dropsNamesPromise;
}

export function useDropsGameNames(): Map<string, DropCampaign> {
  const [map, setMap] = useState<Map<string, DropCampaign>>(() => dropsNamesCache ?? new Map());
  useEffect(() => {
    if (!dropsNamesCache) void loadDropsGameNames().then(setMap);
  }, []);
  return map;
}

export const MobileStreamCard: React.FC<{
  stream: TwitchStream;
  dropsGameNames?: Map<string, DropCampaign>;
  onPress: (stream: TwitchStream) => void;
}> = ({ stream, dropsGameNames, onPress }) => {
  const hasDrops = !!(
    stream.game_name && dropsGameNames?.has(stream.game_name.toLowerCase())
  );

  return (
    <button
      onClick={() => onPress(stream)}
      className="w-full text-left glass-panel media-card p-2.5 active:opacity-80 transition-opacity"
    >
      <div className="relative mb-2 overflow-hidden rounded">
        <img
          loading="lazy"
          src={thumbUrl(stream)}
          alt=""
          className="w-full aspect-video object-cover"
          draggable={false}
        />
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
          <div className="live-dot text-xs px-1.5 py-0.5">LIVE</div>
          {hasDrops && (
            <div className="drops-badge-glass">
              <Gift size={10} />
              <span>DROPS</span>
            </div>
          )}
        </div>
        <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 glass-badge text-white text-xs font-medium rounded">
          {stream.viewer_count.toLocaleString()} viewers
        </div>
      </div>
      <div className="space-y-0.5">
        <h3 className="text-textPrimary font-medium text-[15px] leading-snug line-clamp-1">
          <StreamTitleWithEmojis title={stream.title} />
        </h3>
        <div className="flex items-center gap-1 text-textSecondary text-[13px]">
          <span className="truncate">{stream.user_name}</span>
          {stream.broadcaster_type === 'partner' && (
            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="#9146FF">
              <path
                fillRule="evenodd"
                d="M12.5 3.5 8 2 3.5 3.5 2 8l1.5 4.5L8 14l4.5-1.5L14 8l-1.5-4.5ZM7 11l4.5-4.5L10 5 7 8 5.5 6.5 4 8l3 3Z"
                clipRule="evenodd"
              ></path>
            </svg>
          )}
        </div>
        {stream.game_name && (
          <div className="flex items-center gap-1 text-textMuted text-[13px]">
            <span className="line-clamp-1">{stream.game_name}</span>
            {hasDrops && <Gift size={10} className="text-accent flex-shrink-0" />}
          </div>
        )}
      </div>
    </button>
  );
};
