// Followed live channels: single-column card feed, pull-driven refresh via the
// refresh affordance (touch pull-to-refresh arrives with the polish pass).
import React, { useEffect } from 'react';
import { ArrowClockwise } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { MobileStreamCard } from '../ui/MobileStreamCard';
import type { TwitchStream } from '../../types';

export const FollowingScreen: React.FC = () => {
  const followedStreams = useAppStore((s) => s.followedStreams);
  const loadFollowedStreams = useAppStore((s) => s.loadFollowedStreams);
  const startStream = useAppStore((s) => s.startStream);

  useEffect(() => {
    if (followedStreams.length === 0) void loadFollowedStreams();
    // Load once on mount; the refresh button and the boot listener keep it fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPress = (stream: TwitchStream) => {
    void startStream(stream.user_login, stream);
  };

  return (
    <div className="sn-mobile-screen">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-xl font-bold text-textPrimary">Following</h1>
        <button
          onClick={() => void loadFollowedStreams()}
          className="sn-touch flex items-center justify-center text-textSecondary active:text-textPrimary"
          aria-label="Refresh"
        >
          <ArrowClockwise size={20} />
        </button>
      </div>
      {followedStreams.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-sm text-textMuted">
          No followed channels are live right now.
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {followedStreams.map((s) => (
            <MobileStreamCard key={s.id} stream={s} onPress={onPress} />
          ))}
        </div>
      )}
    </div>
  );
};
