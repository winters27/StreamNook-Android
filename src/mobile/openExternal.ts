// Opening a link outside the app, on Android.
//
// NOT `@tauri-apps/plugin-shell`'s `open`, which is what every call site here
// used to reach for and why the update button did nothing at all.
//
// That plugin's `open` bottoms out in the `open` crate's `that_detached`, which
// launches a helper program: `xdg-open`, `open` or `start` depending on the OS.
// Android has none of them, and the shell plugin ships no Android implementation
// to cover for it (its `android/` folder is API scaffolding only). So the call
// failed on the phone every time while working perfectly on desktop, which is
// exactly the shape of bug that survives testing.
//
// `tauri-plugin-opener` is the supported replacement (shell's open is marked
// deprecated in favour of it) and it has a real `OpenerPlugin.kt`. It was
// already registered in Rust; what was missing was the ACL grant, added as
// `opener:allow-open-url` in `capabilities/mobile.json`.
//
// Invoked by command name rather than through `@tauri-apps/plugin-opener`, to
// avoid a JS dependency for a single call.
//
// The grant needs a SCOPE, which is the part that is easy to miss and which cost
// a second round trip here. `opener:allow-open-url` on its own enables the
// command with an empty allow-list, and `open_url` checks every url against that
// list before doing anything - so the bare permission turns "cannot open" into
// "forbidden url", which looks identical from the outside. The capability grants
// it as an object with `allow: [{ url: "https://*" }, ...]`.
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '../utils/logger';

/**
 * Hands a url to Android. Returns whether it was accepted.
 *
 * Callers are expected to tell the user when this returns false. The previous
 * code logged and returned, which on a release build (no console, no devtools)
 * is indistinguishable from a button that does nothing.
 */
export async function openExternal(url: string): Promise<boolean> {
  try {
    await invoke('plugin:opener|open_url', { url });
    return true;
  } catch (err) {
    Logger.error('[openExternal] could not open', url, err);
    return false;
  }
}
