// How the watch surface arranges player and chat on a screen big enough for
// both arrangements: a Fold's inner display, or a tablet.
//
// `auto` picks whichever gives the video more height while leaving chat usable,
// which on an unfolded Fold means stacked and on a landscape tablet means
// columns. But it stays a DEFAULT, not a verdict. On a near-square screen both
// arrangements are legitimate: columns give you video and chat at full height
// at the cost of a small picture, stacked gives you a big picture with
// pillarbox bars either side. Which of those is the better trade is the
// viewer's call, not ours.
//
// Persisted the same way the stream card/list preference is, so a choice made
// on the sofa is still there tomorrow.
export type WatchLayout = 'auto' | 'stacked' | 'columns';

const KEY = 'sn-watch-layout';

export function readWatchLayout(): WatchLayout {
  const v = localStorage.getItem(KEY);
  return v === 'stacked' || v === 'columns' ? v : 'auto';
}

export function writeWatchLayout(mode: WatchLayout): void {
  localStorage.setItem(KEY, mode);
}
