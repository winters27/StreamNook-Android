// Update checking for the sideloaded Android build.
//
// There is no store to do this for us. The APK is downloaded from
// streamnook.app, so nothing tells a user a newer build exists unless the app
// asks - and until now nothing did: `/api/v1/update-android` has been serving a
// manifest that no client ever read.
//
// The flow is deliberately hands-off. We do NOT download or install anything:
// we open the same public download URL in the browser, and Android's package
// installer takes over from there (the manifest ships REQUEST_INSTALL_PACKAGES
// for exactly that). Downloading an APK ourselves would mean owning storage,
// permissions, integrity checking and the installer intent, to arrive at the
// same place the browser reaches on its own.
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '../utils/logger';

const MANIFEST_URL = 'https://streamnook.app/api/v1/update-android';
const DOWNLOAD_URL = 'https://streamnook.app/download/android';

export interface AndroidUpdate {
  current: string;
  latest: string;
  notes?: string;
  /** Bytes, for showing the size before someone commits to a download. */
  size?: number;
}

/**
 * Numeric-segment comparison. Deliberately not a semver library for one
 * greater-than check, and deliberately NOT a string compare: "0.10.0" sorts
 * before "0.9.0" lexically, which would silently stop offering updates the
 * moment a minor version reaches double digits.
 */
function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Returns the update when one is available, otherwise null. Never throws. */
export async function checkForAndroidUpdate(): Promise<AndroidUpdate | null> {
  try {
    const current = await invoke<string>('get_current_app_version');
    // no-store: an edge-cached manifest is how a release goes out and nobody
    // hears about it for an hour.
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    // 503 is the documented "no build published yet" state, not a failure.
    if (!res.ok) return null;
    const m = (await res.json()) as { version?: string; notes?: string; size?: number };
    if (!m.version || !isNewer(m.version, current)) return null;
    return { current, latest: m.version, notes: m.notes, size: m.size };
  } catch (err) {
    // A failed check must never block the app or nag. Silence is correct here:
    // the user did not ask for this, and it retries next launch.
    Logger.warn('[Update] check failed:', err);
    return null;
  }
}

/** Hands off to the browser, which hands off to Android's package installer. */
export async function openAndroidUpdate(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(DOWNLOAD_URL);
  } catch (err) {
    Logger.error('[Update] could not open the download page:', err);
  }
}
