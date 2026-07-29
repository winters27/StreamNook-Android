// Followed live channels: card feed or compact list, user's choice persisted.
import React, { useEffect, useState } from 'react';
import { ListBullets, SquaresFour } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { MobileStreamCard, useDropsGameNames } from '../ui/MobileStreamCard';
import { PullToRefresh } from '../ui/PullToRefresh';
import { SkeletonCards } from '../ui/SkeletonCards';
import type { TwitchStream } from '../../types';

type ViewMode = 'cards' | 'list';
const VIEW_KEY = 'sn-following-view';

export const FollowingScreen: React.FC = () => {
  const followedStreams = useAppStore((s) => s.followedStreams);
  const loadFollowedStreams = useAppStore((s) => s.loadFollowedStreams);
  const startStream = useAppStore((s) => s.startStream);
  const [firstLoad, setFirstLoad] = useState(followedStreams.length === 0);
  // View choice persists: if a user can choose it, it survives restart.
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'),
  );
  const dropsGameNames = useDropsGameNames();

  const setViewPersisted = (mode: ViewMode) => {
    setView(mode);
    localStorage.setItem(VIEW_KEY, mode);
  };

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
      <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
        <h1 className="text-xl font-bold text-textPrimary">Following</h1>
        <div className="flex">
          <button
            onClick={() => setViewPersisted('cards')}
            className={`sn-touch flex items-center justify-center ${
              view === 'cards' ? 'text-accent' : 'text-textMuted'
            }`}
            aria-label="Card view"
          >
            <SquaresFour size={20} weight={view === 'cards' ? 'fill' : 'regular'} />
          </button>
          <button
            onClick={() => setViewPersisted('list')}
            className={`sn-touch flex items-center justify-center ${
              view === 'list' ? 'text-accent' : 'text-textMuted'
            }`}
            aria-label="List view"
          >
            <ListBullets size={20} weight={view === 'list' ? 'bold' : 'regular'} />
          </button>
        </div>
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
          <div
            className={`flex flex-col px-4 sn-tabbar-clearance ${
              view === 'list' ? 'gap-2' : 'gap-3'
            }`}
          >
            {followedStreams.map((s) => (
              <MobileStreamCard
                key={s.id}
                stream={s}
                dropsGameNames={dropsGameNames}
                onPress={onPress}
                variant={view === 'list' ? 'row' : 'card'}
              />
            ))}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
};
