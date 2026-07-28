// Runtime platform detection for the mobile port.
//
// This deliberately reads the user agent rather than @tauri-apps/plugin-os.
// The plugin would work, but it is an extra dependency AND an extra entry in
// capabilities/*.json (platform() is denied by the ACL without `os:default`),
// and it is async on some paths. The Android System WebView always reports
// "Android" in its UA, so this is both simpler and synchronous, which matters
// because the layout branch has to be correct on the very first render.

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;

/** True inside the Android (and later iOS) builds, false on every desktop. */
export const IS_MOBILE = /android|iphone|ipad|ipod/i.test(ua);

export const IS_ANDROID = /android/i.test(ua);

/**
 * Portrait is the orientation the desktop layout cannot survive: it is a flex
 * row (sidebar + video + chat), so a docked chat panel squeezes the video to
 * nothing. Landscape is close enough to a small desktop window to reuse.
 */
export function isPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerHeight >= window.innerWidth;
}

/** Subscribe to orientation flips. Returns an unsubscribe. */
export function onOrientationChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', fn);
  window.addEventListener('orientationchange', fn);
  return () => {
    window.removeEventListener('resize', fn);
    window.removeEventListener('orientationchange', fn);
  };
}
