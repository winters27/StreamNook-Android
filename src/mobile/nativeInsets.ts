// Pull half of the native inset bridge. MainActivity pushes CSS vars on every
// inset change, but a page (re)load starts with a fresh document that missed
// the last push; the synchronous `SNInsets` JavascriptInterface fills that gap.
interface NativeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
  kb: number;
}

export function applyNativeInsetsOnce(): void {
  try {
    const bridge = (window as Window & { SNInsets?: { get(): string } }).SNInsets;
    const raw = bridge?.get();
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<NativeInsets>;
    if (typeof v.top !== 'number') return;
    const d = document.documentElement;
    d.style.setProperty('--sn-inset-t', `${v.top}px`);
    d.style.setProperty('--sn-inset-r', `${v.right ?? 0}px`);
    d.style.setProperty('--sn-inset-b', `${v.bottom ?? 0}px`);
    d.style.setProperty('--sn-inset-l', `${v.left ?? 0}px`);
    d.style.setProperty('--sn-kb', `${v.kb ?? 0}px`);
    d.dataset.snNativeInsets = 'true';
  } catch {
    /* bridge absent (desktop, dev browser): env() fallback applies */
  }
}
