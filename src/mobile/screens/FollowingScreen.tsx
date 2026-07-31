// Followed live channels: card feed or compact list, user's choice persisted.
import React, { useEffect, useState } from 'react';
import { ListBullets, SquaresFour } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { markFollowingFresh } from '../followRefresh';
import { MobileStreamCard, useDropsGameNames } from '../ui/MobileStreamCard';
import { PullToRefresh } from '../ui/PullToRefresh';
import { SkeletonCards } from '../ui/SkeletonCards';
import { AdaptiveGrid } from '../ui/AdaptiveGrid';
import type { TwitchStream } from '../../types';

export type StreamViewMode = 'cards' | 'list';
// One shared view preference for every stream list (Following + Browse).
const VIEW_KEY = 'sn-stream-view';
const LEGACY_VIEW_KEY = 'sn-following-view';

export function readStreamView(): StreamViewMode {
  const v = localStorage.getItem(VIEW_KEY) ?? localStorage.getItem(LEGACY_VIEW_KEY);
  return v === 'list' ? 'list' : 'cards';
}

export function writeStreamView(mode: StreamViewMode): void {
  localStorage.setItem(VIEW_KEY, mode);
}

export const FollowingScreen: React.FC = () => {
  const followedStreams = useAppStore((s) => s.followedStreams);
  const loadFollowedStreams = useAppStore((s) => s.loadFollowedStreams);
  const startStream = useAppStore((s) => s.startStream);
  const activeHypeTrainChannels = useAppStore((s) => s.activeHypeTrainChannels);
  const refreshHypeTrainStatuses = useAppStore((s) => s.refreshHypeTrainStatuses);
  const watchStreaks = useAppStore((s) => s.watchStreaks);
  const [firstLoad, setFirstLoad] = useState(followedStreams.length === 0);
  // View choice persists: if a user can choose it, it survives restart.
  const [view, setView] = useState<StreamViewMode>(readStreamView);
  const dropsGameNames = useDropsGameNames();

  const setViewPersisted = (mode: StreamViewMode) => {
    setView(mode);
    writeStreamView(mode);
  };

  useEffect(() => {
    const boot = async () => {
      if (useAppStore.getState().followedStreams.length === 0) {
        await loadFollowedStreams().catch(() => {});
        markFollowingFresh();
        setFirstLoad(false);
      }
      // Hype train badges ride a separate status poll, same as desktop Home.
      const ids = useAppStore.getState().followedStreams.map((s) => s.user_id);
      if (ids.length) void refreshHypeTrainStatuses(ids);
    };
    void boot();
    // Loads once on mount. Staying fresh after that is the resume handler's job
    // (lifecycle.ts -> refreshFollowingIfStale), because this effect is guarded
    // on the list being EMPTY and the Android activity survives backgrounding,
    // so nothing here re-runs when the user comes back to a days-old list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    await loadFollowedStreams();
    // Shares the throttle with the resume path, so pulling to refresh and then
    // switching away and back does not fetch the same thing twice.
    markFollowingFresh();
    const ids = useAppStore.getState().followedStreams.map((s) => s.user_id);
    if (ids.length) await refreshHypeTrainStatuses(ids);
  };

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
        onRefresh={refresh}
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
          <AdaptiveGrid
            variant={view === 'list' ? 'row' : 'card'}
            gap={view === 'list' ? 8 : 12}
            className="px-4 sn-tabbar-clearance"
          >
            {followedStreams.map((s) => (
              <MobileStreamCard
                key={s.id}
                stream={s}
                dropsGameNames={dropsGameNames}
                hypeTrain={activeHypeTrainChannels.get(s.user_id) ?? undefined}
                watchStreak={watchStreaks[s.user_id]}
                onPress={onPress}
                variant={view === 'list' ? 'row' : 'card'}
              />
            ))}
          </AdaptiveGrid>
        )}
      </PullToRefresh>
    </div>
  );
};
