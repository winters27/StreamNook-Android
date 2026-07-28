// The watch layer: mounted above the tab shell while a stream is active.
// Portrait: 16:9 player band + stream info + chat below (Twitch-app shape).
// Landscape: full-viewport immersive player with a chat toggle overlay.
import React, { useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { useOrientation } from '../ui/useOrientation';
import { MobilePlayer } from '../player/MobilePlayer';
import { MobileChatPane } from '../chat/MobileChatPane';
import LoadingWidget from '../../components/LoadingWidget';

export const WatchScreen: React.FC = () => {
  const isLoading = useAppStore((s) => s.isLoading);
  const streamUrl = useAppStore((s) => s.streamUrl);
  const currentStream = useAppStore((s) => s.currentStream);
  const orientation = useOrientation();
  const [landscapeChat, setLandscapeChat] = useState(false);

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
      {/* Stream info row */}
      {currentStream && (
        <div className="shrink-0 px-3.5 py-2.5 border-b border-borderSubtle">
          <div className="text-[15px] font-semibold text-textPrimary truncate leading-snug">
            {currentStream.title}
          </div>
          <div className="text-[13px] text-textSecondary truncate mt-0.5">
            {currentStream.user_name}
            {currentStream.game_name ? ` · ${currentStream.game_name}` : ''}
          </div>
        </div>
      )}
      <MobileChatPane />
    </div>
  );
};
