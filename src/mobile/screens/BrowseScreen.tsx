// Discover: Live streams and Categories, with search covering both modes.
import React, { useEffect, useRef, useState } from 'react';
import { ListBullets, MagnifyingGlass, SquaresFour, X } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import { useHypeTrains } from '../useHypeTrains';
import { MobileStreamCard, useDropsGameNames } from '../ui/MobileStreamCard';
import { readStreamView, writeStreamView, type StreamViewMode } from './FollowingScreen';
import { PullToRefresh } from '../ui/PullToRefresh';
import { SkeletonCards } from '../ui/SkeletonCards';
import { AdaptiveGrid } from '../ui/AdaptiveGrid';
import { Logger } from '../../utils/logger';
import { gameBoxArt } from '../../utils/boxArt';
import type { TwitchCategory, TwitchStream } from '../../types';

type BrowseMode = 'live' | 'categories';

function boxArt(category: TwitchCategory): string {
  return gameBoxArt(category.box_art_url, 285, 380);
}

// Top categories, module-cached for the session (pull-to-refresh reloads).
let topCategoriesCache: TwitchCategory[] | null = null;

export const BrowseScreen: React.FC = () => {
  const recommendedStreams = useAppStore((s) => s.recommendedStreams);
  const loadRecommendedStreams = useAppStore((s) => s.loadRecommendedStreams);
  const startStream = useAppStore((s) => s.startStream);
  const openBrowseCategory = useMobileNavStore((s) => s.openBrowseCategory);
  const dropsGameNames = useDropsGameNames();

  const [mode, setMode] = useState<BrowseMode>('live');
  const [view, setView] = useState<StreamViewMode>(readStreamView);
  const activeHypeTrainChannels = useAppStore((s) => s.activeHypeTrainChannels);
  const watchStreaks = useAppStore((s) => s.watchStreaks);

  const setViewPersisted = (v: StreamViewMode) => {
    setView(v);
    writeStreamView(v);
  };
  const [query, setQuery] = useState('');
  const [streamResults, setStreamResults] = useState<TwitchStream[] | null>(null);
  const [categoryResults, setCategoryResults] = useState<TwitchCategory[] | null>(null);
  const [categories, setCategories] = useState<TwitchCategory[]>(topCategoriesCache ?? []);
  const [searching, setSearching] = useState(false);
  const [firstLoad, setFirstLoad] = useState(recommendedStreams.length === 0);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (recommendedStreams.length === 0) {
      void loadRecommendedStreams().finally(() => setFirstLoad(false));
    } else {
      setFirstLoad(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCategories = async () => {
    setCategoriesLoading(true);
    try {
      const [games] = await invoke<[TwitchCategory[], string | null]>(
        'get_top_games_paginated',
        { cursor: null, limit: 30 },
      );
      topCategoriesCache = games ?? [];
      setCategories(topCategoriesCache);
    } catch (err) {
      Logger.warn('[BrowseScreen] categories load failed:', err);
    } finally {
      setCategoriesLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'categories' && categories.length === 0) void loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const runSearch = async (q: string, seq: number, searchMode: BrowseMode) => {
    try {
      if (searchMode === 'live') {
        const found = await invoke<TwitchStream[]>('search_channels', { query: q });
        if (seq === searchSeq.current) setStreamResults(found);
      } else {
        const found = await invoke<TwitchCategory[]>('search_categories', {
          query: q,
          limit: 40,
        });
        if (seq === searchSeq.current) setCategoryResults(found);
      }
    } catch (err) {
      Logger.warn('[BrowseScreen] search failed:', err);
      if (seq === searchSeq.current) {
        if (searchMode === 'live') setStreamResults([]);
        else setCategoryResults([]);
      }
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  // Debounced search in whichever mode is active.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setStreamResults(null);
      setCategoryResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(() => void runSearch(trimmed, seq, mode), 350);
    return () => clearTimeout(t);
  }, [query, mode]);

  const refresh = async () => {
    const trimmed = query.trim();
    if (trimmed) {
      const seq = ++searchSeq.current;
      setSearching(true);
      await runSearch(trimmed, seq, mode);
    } else if (mode === 'live') {
      await loadRecommendedStreams();
    } else {
      await loadCategories();
    }
  };

  const shownStreams = streamResults ?? recommendedStreams;
  // Browse already drew the badge but never fetched the statuses, so a train
  // only ever showed for channels that happened to also be in your following.
  useHypeTrains(shownStreams);
  const shownCategories = categoryResults ?? categories;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <h1 className="text-xl font-bold text-textPrimary mb-3">Browse</h1>
        <div className="relative mb-2.5">
          <MagnifyingGlass
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none z-10"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'live' ? 'Search channels' : 'Search categories'}
            className="glass-input w-full h-11 pl-10 pr-10 text-[15px] text-textPrimary placeholder:text-textMuted bg-transparent outline-none"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 sn-touch flex items-center justify-center text-textMuted"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {/* Mode segments: borderless text buttons with the sliding active pill
            look shared with the desktop Home nav. */}
        <div className="flex items-center gap-1">
          {(['live', 'categories'] as BrowseMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3.5 py-1.5 rounded-full text-sm transition-colors ${
                mode === m
                  ? 'glass-button-static text-textPrimary font-semibold'
                  : 'text-textMuted'
              }`}
            >
              {m === 'live' ? 'Live' : 'Categories'}
            </button>
          ))}
          {mode === 'live' && (
            <div className="flex ml-auto">
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
          )}
        </div>
      </div>
      <PullToRefresh onRefresh={refresh}>
        {mode === 'live' ? (
          firstLoad || (searching && shownStreams.length === 0) ? (
            <SkeletonCards />
          ) : shownStreams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-1">
              <div className="text-sm text-textMuted">
                {streamResults ? 'No channels found.' : 'Nothing to recommend yet.'}
              </div>
              <div className="text-[13px] text-textMuted">Pull down to refresh.</div>
            </div>
          ) : (
            <AdaptiveGrid
              variant={view === 'list' ? 'row' : 'card'}
              gap={view === 'list' ? 8 : 12}
              className="px-4 sn-tabbar-clearance"
            >
              {shownStreams.map((s) => (
                <MobileStreamCard
                  key={s.id}
                  stream={s}
                  dropsGameNames={dropsGameNames}
                  hypeTrain={activeHypeTrainChannels.get(s.user_id) ?? undefined}
                  watchStreak={watchStreaks[s.user_id]}
                  onPress={(stream) => void startStream(stream.user_login, stream)}
                  variant={view === 'list' ? 'row' : 'card'}
                />
              ))}
            </AdaptiveGrid>
          )
        ) : categoriesLoading || (searching && shownCategories.length === 0) ? (
          <SkeletonCards />
        ) : shownCategories.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-textMuted">
            {categoryResults ? 'No categories found.' : 'No categories yet, pull to refresh.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 px-4 sn-tabbar-clearance">
            {shownCategories.map((c) => (
              <button
                key={c.id}
                onClick={() => openBrowseCategory(c)}
                className="glass-panel media-card p-2 text-left active:opacity-80 transition-opacity"
              >
                <img
                  loading="lazy"
                  src={boxArt(c)}
                  alt=""
                  className="w-full aspect-[3/4] object-cover rounded mb-1.5"
                  draggable={false}
                />
                <div className="text-[13px] font-medium text-textPrimary line-clamp-1">
                  {c.name}
                </div>
              </button>
            ))}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
};
