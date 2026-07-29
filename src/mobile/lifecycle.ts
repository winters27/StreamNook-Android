// Background/foreground lifecycle for the mobile shell.
//
// A phone spends most of its time with the app backgrounded, and Android
// throttles WebView timers there rather than stopping them: the badge-drop
// socket keeps pinging, Supabase realtime holds its socket, and hls.js keeps
// pulling segments for a stream nobody is watching. That is battery and data
// spent on nothing, and on resume the backlogged timers all fire at once.
//
// So: stand everything down when hidden and bring it back on resume. The one
// deliberate exception is picture-in-picture, where the video IS still on
// screen and must keep playing.
import { getActiveVideo } from '../utils/activeVideo';
import { refreshEntitlementRegistries } from '../services/supabaseService';
import { Logger } from '../utils/logger';

let installed = false;

function inPictureInPicture(): boolean {
  return document.documentElement.dataset.snPip === 'true';
}

async function onHidden(): Promise<void> {
  if (inPictureInPicture()) return;
  try {
    const { stopBadgeFeed } = await import('../services/badgeSocketService');
    stopBadgeFeed();
  } catch (err) {
    Logger.warn('[Lifecycle] badge feed pause failed:', err);
  }
  // hls.js keeps fetching segments while hidden; stopping the load leaves the
  // element and instance intact so resume is a startLoad, not a re-attach.
  const video = getActiveVideo();
  if (video && !video.paused) {
    try {
      video.pause();
    } catch {
      /* element already gone */
    }
  }
}

async function onVisible(): Promise<void> {
  try {
    const { startBadgeFeed } = await import('../services/badgeSocketService');
    startBadgeFeed();
  } catch (err) {
    Logger.warn('[Lifecycle] badge feed resume failed:', err);
  }
  // Entitlements may have changed while away (a purchase completed in a
  // browser, a badge granted). The registries themselves self-heal, this just
  // pulls once on return.
  try {
    refreshEntitlementRegistries();
  } catch {
    /* not configured */
  }
}

/** Idempotent; returns a teardown. */
export function installLifecycle(): () => void {
  if (installed) return () => {};
  installed = true;

  const handler = () => {
    if (document.visibilityState === 'hidden') void onHidden();
    else void onVisible();
  };
  document.addEventListener('visibilitychange', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    installed = false;
  };
}
