// Discover: top recommended streams plus channel search, touch-sized.
import React, { useEffect, useRef, useState } from 'react';
import { MagnifyingGlass, X } from 'phosphor-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { MobileStreamCard } from '../ui/MobileStreamCard';
import { Logger } from '../../utils/logger';
import type { TwitchStream } from '../../types';

export const BrowseScreen: React.FC = () => {
  const recommendedStreams = useAppStore((s) => s.recommendedStreams);
  const loadRecommendedStreams = useAppStore((s) => s.loadRecommendedStreams);
  const startStream = useAppStore((s) => s.startStream);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TwitchStream[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (recommendedStreams.length === 0) void loadRecommendedStreams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced channel search against the same backend command Home uses.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const found = await invoke<TwitchStream[]>('search_channels', { query: trimmed });
        if (seq === searchSeq.current) setResults(found);
      } catch (err) {
        Logger.warn('[BrowseScreen] search failed:', err);
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const onPress = (stream: TwitchStream) => {
    void startStream(stream.user_login, stream);
  };

  const shown = results ?? recommendedStreams;

  return (
    <div className="sn-mobile-screen">
      <div className="px-4 pt-3 pb-2">
        <h1 className="text-xl font-bold text-textPrimary mb-3">Browse</h1>
        <div className="relative">
          <MagnifyingGlass
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search channels"
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
      </div>
      {searching && (
        <div className="px-4 py-2 text-sm text-textMuted">Searching…</div>
      )}
      {shown.length === 0 && !searching ? (
        <div className="flex items-center justify-center py-20 text-sm text-textMuted">
          {results ? 'No channels found.' : 'Nothing to recommend yet.'}
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {shown.map((s) => (
            <MobileStreamCard key={s.id} stream={s} onPress={onPress} />
          ))}
        </div>
      )}
    </div>
  );
};
