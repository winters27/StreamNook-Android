// Followed live channels: single-column card feed with pull-to-refresh.
import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { MobileStreamCard } from '../ui/MobileStreamCard';
import { PullToRefresh } from '../ui/PullToRefresh';
import { SkeletonCards } from '../ui/SkeletonCards';
import type { TwitchStream } from '../../types';

export const FollowingScreen: React.FC = () => {
  const followedStreams = useAppStore((s) => s.followedStreams);
  const loadFollowedStreams = useAppStore((s) => s.loadFollowedStreams);
  const startStream = useAppStore((s) => s.startStream);
  const [firstLoad, setFirstLoad] = useState(followedStreams.length === 0);

  useEffect(() => {
    if (followedStreams.length === 0) {
      void loadFollowedStreams().finally(() => setFirstLoad(false));
    } else {
      setFirstLoad(false);
    }
    // Load once on mount; pull-to-refresh and the boot listener keep it fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPress = (stream: TwitchStream) => {
    void startStream(stream.user_login, stream);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <h1 className="text-xl font-bold text-textPrimary">Following</h1>
      </div>
      <PullToRefresh
        onRefresh={loadFollowedStreams}
        className="px-0 [padding-left:var(--sn-safe-l)] [padding-right:var(--sn-safe-r)]"
      >
        {firstLoad ? (
          <SkeletonCards />
        ) : followedStreams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-1">
            <div className="text-sm text-textMuted">No followed channels are live right now.</div>
            <div className="text-[13px] text-textMuted">Pull down to refresh.</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-4 pb-4">
            {followedStreams.map((s) => (
              <MobileStreamCard key={s.id} stream={s} onPress={onPress} />
            ))}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
};
