// Touch-native stream card: full-width thumbnail, 44px+ tap target, long-press
// ready. The desktop Home renders its cards inline; this is the mobile
// counterpart shared by Following, Browse, and search results.
import React from 'react';
import type { TwitchStream } from '../../types';

function thumbUrl(stream: TwitchStream): string {
  // Helix thumbnail templates carry {width}x{height} placeholders.
  return stream.thumbnail_url
    .replace('{width}', '640')
    .replace('{height}', '360');
}

function viewers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
}

export const MobileStreamCard: React.FC<{
  stream: TwitchStream;
  onPress: (stream: TwitchStream) => void;
}> = ({ stream, onPress }) => (
  <button
    onClick={() => onPress(stream)}
    className="w-full text-left glass-panel media-card overflow-hidden active:opacity-80 transition-opacity"
  >
    <div className="relative w-full aspect-video bg-background-tertiary">
      <img
        src={thumbUrl(stream)}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover"
        draggable={false}
      />
      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-live/90 text-white leading-none">
        LIVE
      </span>
      <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[11px] bg-black/70 text-white leading-none">
        {viewers(stream.viewer_count)} viewers
      </span>
    </div>
    <div className="px-3 py-2.5">
      <div className="text-[15px] font-semibold text-textPrimary truncate leading-snug">
        {stream.title}
      </div>
      <div className="text-[13px] text-textSecondary truncate mt-0.5">
        {stream.user_name}
      </div>
      {stream.game_name && (
        <div className="text-[13px] text-textMuted truncate mt-0.5">{stream.game_name}</div>
      )}
    </div>
  </button>
);
