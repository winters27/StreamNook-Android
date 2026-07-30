// Category drill: live streams for one category, layered above the tab shell
// (and below the watch layer, so back exits the stream first).
import React, { useCallback, useEffect, useState } from 'react';
import { CaretLeft } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import { MobileStreamCard, useDropsGameNames } from '../ui/MobileStreamCard';
import { PullToRefresh } from '../ui/PullToRefresh';
import { SkeletonCards } from '../ui/SkeletonCards';
import { Logger } from '../../utils/logger';
import type { TwitchStream } from '../../types';

type Category = NonNullable<ReturnType<typeof useMobileNavStore.getState>['browseCategory']>;

export const CategoryStreamsScreen: React.FC = () => {
  const category = useMobileNavStore((s) => s.browseCategory);
  if (!category) return null;
  // Keyed on the category, so opening a different one MOUNTS A FRESH component
  // with an empty list already loading. The alternative — clearing state in an
  // effect — paints the previous category's streams under the new title for a
  // frame first, and costs an extra render every time.
  return <CategoryStreamsList key={category.id} category={category} />;
};

const CategoryStreamsList: React.FC<{ category: Category }> = ({ category }) => {
  const openBrowseCategory = useMobileNavStore((s) => s.openBrowseCategory);
  const startStream = useAppStore((s) => s.startStream);
  const dropsGameNames = useDropsGameNames();

  const [streams, setStreams] = useState<TwitchStream[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div
      className="absolute inset-0 z-[35] bg-background flex flex-col"
      style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
    >
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 px-4 sn-tabbar-clearance">
            {streams.map((s) => (
              <MobileStreamCard
                key={s.id}
                stream={s}
                dropsGameNames={dropsGameNames}
                onPress={(stream) => void startStream(stream.user_login, stream)}
              />
            ))}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
};
