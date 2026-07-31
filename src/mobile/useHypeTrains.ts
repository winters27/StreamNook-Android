// Hype-train badges for whatever stream list a screen is showing.
//
// The port's recurring failure mode, and this is another instance of it: mobile
// RENDERS a signal that the desktop component also FETCHES, and only the fetch
// is missing. `BrowseScreen` already read `activeHypeTrainChannels` and drew the
// badge, but nothing ever populated it for browse results, so a train only
// appeared if that channel happened to ALSO be in your following list.
// `CategoryStreamsScreen` did not even pass the prop. Following worked purely
// because `FollowingScreen` does its own fetch.
//
// Desktop has one owner for this: `Home.tsx` refreshes the UNION of following,
// recommended, category and search results, debounced 2s so the request does not
// compete with HLS segments. The mobile shell has no equivalent single place --
// every screen owns its own list -- so this hook is that owner, per screen.
import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/AppStore';
import type { TwitchStream } from '../types';

// Matches desktop. The delay is not politeness, it is to keep this off the wire
// while HLS segments are in flight.
const DEBOUNCE_MS = 2000;

export function useHypeTrains(streams: TwitchStream[]): void {
  const refreshHypeTrainStatuses = useAppStore((s) => s.refreshHypeTrainStatuses);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Key on the SET of ids, not the array. A list re-fetched with the same
  // channels (pull-to-refresh, a viewer-count tick) produces a new array every
  // time, and depending on that would re-request on every render.
  const key = Array.from(new Set(streams.map((s) => s.user_id).filter(Boolean)))
    .sort()
    .join(',');

  useEffect(() => {
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void refreshHypeTrainStatuses(key.split(','));
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, refreshHypeTrainStatuses]);
}
