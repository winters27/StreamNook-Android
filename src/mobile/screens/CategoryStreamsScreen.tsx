// Category drill: live streams for one category, layered above the tab shell
// (and below the watch layer, so back exits the stream first).
import React, { useCallback, useEffect, useState } from 'react';
import { CaretLeft } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import { DrillInScreen } from '../ui/DrillInScreen';
import { useHypeTrains } from '../useHypeTrains';
import { MobileStreamCard, useDropsGameNames } from '../ui/MobileStreamCard';
import { AdaptiveGrid } from '../ui/AdaptiveGrid';
import { PullToRefresh } from '../ui/PullToRefresh';
import { SkeletonCards } from '../ui/SkeletonCards';
import { Logger } from '../../utils/logger';
import type { TwitchStream } from '../../types';

type Category = NonNullable<ReturnType<typeof useMobileNavStore.getState>['browseCategory']>;

export const CategoryStreamsScreen: React.FC = () => {
  const category = useMobileNavStore((s) => s.browseCategory);
  // Retained so the list still renders while the layer slides OUT; `category`
  // is already null by then and the screen would blank mid-animation.
  const [last, setLast] = useState<Category | null>(category);
  if (category && category !== last) setLast(category);

  return (
    <DrillInScreen
      open={!!category}
      layerKey="category"
      className="absolute inset-0 z-[35] bg-background flex flex-col"
      style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
    >
      {/* Keyed on the category, so opening a different one MOUNTS A FRESH
          component with an empty list already loading. The alternative -
          clearing state in an effect - paints the previous category's streams
          under the new title for a frame first, and costs an extra render
          every time. */}
      {last && <CategoryStreamsList key={last.id} category={last} />}
    </DrillInScreen>
  );
};

const CategoryStreamsList: React.FC<{ category: Category }> = ({ category }) => {
  const openBrowseCategory = useMobileNavStore((s) => s.openBrowseCategory);
  const startStream = useAppStore((s) => s.startStream);
  const activeHypeTrainChannels = useAppStore((s) => s.activeHypeTrainChannels);
  const watchStreaks = useAppStore((s) => s.watchStreaks);
  const dropsGameNames = useDropsGameNames();

  const [streams, setStreams] = useState<TwitchStream[]>([]);
  const [loading, setLoading] = useState(true);

  // This screen fetched no statuses and passed no badge, so a category drill
  // showed no hype trains at all.
  useHypeTrains(streams);

  const load = useCallback(async () => {
    try {
      const res = await invoke<[TwitchStream[], string | null]>('get_streams_by_game', {
        gameId: category.id,
        cursor: null,
        limit: 40,
      });
      setStreams(res[0] ?? []);
    } catch (err) {
      Logger.warn('[CategoryStreams] load failed:', err);
      setStreams([]);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  // The full-screen frame (position, z, background, top inset) belongs to the
  // DrillInScreen wrapper now, so this is just the contents.
  return (
    <>
      <div className="flex items-center gap-1 px-2 py-2 shrink-0">
        <button
          onClick={() => openBrowseCategory(null)}
          className="sn-touch flex items-center justify-center text-textSecondary"
          aria-label="Back to Browse"
        >
          <CaretLeft size={22} />
        </button>
        <h1 className="text-lg font-bold text-textPrimary truncate">{category.name}</h1>
      </div>
      <PullToRefresh onRefresh={load}>
        {loading ? (
          <SkeletonCards />
        ) : streams.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-textMuted">
            No live streams in this category.
          </div>
        ) : (
          // Was `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`, which is the exact
          // anti-pattern AdaptiveGrid was written for: Tailwind's breakpoints
          // are viewport-width buckets, so on an unfolded Fold `md:grid-cols-2`
          // puts its gutter at 50% of the viewport - straight down the crease.
          // AdaptiveGrid aligns the gutter TO the hinge instead, and this screen
          // now matches Following and Browse rather than having its own rules.
          <AdaptiveGrid variant="card" gap={12} className="px-4 sn-tabbar-clearance">
            {streams.map((s) => (
              <MobileStreamCard
                key={s.id}
                stream={s}
                dropsGameNames={dropsGameNames}
                // Neither of these was passed, so a card here was missing
                // identity the same card carries on Following and Browse.
                hypeTrain={activeHypeTrainChannels.get(s.user_id) ?? undefined}
                watchStreak={watchStreaks[s.user_id]}
                onPress={(stream) => void startStream(stream.user_login, stream)}
              />
            ))}
          </AdaptiveGrid>
        )}
      </PullToRefresh>
    </>
  );
};
