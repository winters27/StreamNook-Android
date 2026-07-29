// The watch layer: mounted above the tab shell while a stream is active.
// Portrait: 16:9 player band + stream info + chat below (Twitch-app shape).
// Landscape: full-viewport immersive player with a chat toggle overlay.
import React, { useEffect, useState } from 'react';
import { Eye } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { useOrientation } from '../ui/useOrientation';
import { MobilePlayer } from '../player/MobilePlayer';
import { MobileChatPane } from '../chat/MobileChatPane';
import LoadingWidget from '../../components/LoadingWidget';

// "2:14:07" from the Helix started_at timestamp, ticking once a minute.
function formatUptime(startedAt: string, nowMs: number): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return '';
  const totalSec = Math.max(0, Math.floor((nowMs - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const WatchScreen: React.FC = () => {
  const isLoading = useAppStore((s) => s.isLoading);
  const streamUrl = useAppStore((s) => s.streamUrl);
  const currentStream = useAppStore((s) => s.currentStream);
  const orientation = useOrientation();
  const [landscapeChat, setLandscapeChat] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!streamUrl && !isLoading) return null;

  if (isLoading && !streamUrl) {
    return (
      <div className="absolute inset-0 z-40 bg-background flex items-center justify-center">
        <LoadingWidget fullScreen={false} useFunnyMessages={true} />
      </div>
    );
  }

  if (orientation === 'landscape') {
    return (
      <div className="absolute inset-0 z-40 bg-black flex">
        <div className="flex-1 min-w-0">
          <MobilePlayer immersive onToggleFullscreen={() => setLandscapeChat((v) => !v)} />
        </div>
        {landscapeChat && (
          <div className="w-[320px] shrink-0 bg-background flex flex-col">
            <MobileChatPane />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-40 bg-background flex flex-col"
      style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
    >
      {/* 16:9 player band pinned to the top. */}
      <div className="w-full aspect-video shrink-0">
        <MobilePlayer />
      </div>
      {/* Stream info bar: darker like the desktop stream header, with the
          channel line plus live viewers and uptime. */}
      {currentStream && (
        <div className="shrink-0 px-3.5 py-2 border-b border-borderSubtle bg-background-secondary">
          <div className="text-[13.5px] font-semibold text-textPrimary truncate leading-snug">
            {currentStream.title}
          </div>
          <div className="flex items-center gap-2 mt-0.5 min-w-0">
            <span className="text-[12.5px] text-textSecondary truncate">
              {currentStream.user_name}
              {currentStream.game_name ? ` · ${currentStream.game_name}` : ''}
            </span>
            <span className="ml-auto flex items-center gap-2 shrink-0 text-[12px] text-textMuted">
              <span className="flex items-center gap-1 text-live">
                <Eye size={13} weight="fill" />
                {currentStream.viewer_count.toLocaleString()}
              </span>
              {currentStream.started_at && (
                <span>{formatUptime(currentStream.started_at, nowMs)}</span>
              )}
            </span>
          </div>
        </div>
      )}
      <MobileChatPane />
    </div>
  );
};
