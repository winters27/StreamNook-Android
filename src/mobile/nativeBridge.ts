// Thin wrappers over the MainActivity JavascriptInterface (SNInsets). Every
// call is best-effort: the bridge is absent on desktop and in dev browsers.
interface SNBridge {
  get?(): string;
  setImmersive?(immersive: boolean): void;
  setKeepScreenOn?(on: boolean): void;
  setPipEligible?(eligible: boolean): void;
  enterPip?(): void;
  isInPip?(): boolean;
  consumePipClosed?(): boolean;
  setPipSourceRect?(l: number, t: number, r: number, b: number): void;
  setPipMuted?(muted: boolean): void;
  share?(text: string, subject: string): void;
}

function bridge(): SNBridge | undefined {
  return (window as Window & { SNInsets?: SNBridge }).SNInsets;
}

export function setImmersive(immersive: boolean): void {
  try {
    bridge()?.setImmersive?.(immersive);
  } catch {
    /* bridge absent */
  }
}

export function setKeepScreenOn(on: boolean): void {
  try {
    bridge()?.setKeepScreenOn?.(on);
  } catch {
    /* bridge absent */
  }
}

export function setPipEligible(eligible: boolean): void {
  try {
    bridge()?.setPipEligible?.(eligible);
  } catch {
    /* bridge absent */
  }
}

export function enterPip(): void {
  try {
    bridge()?.enterPip?.();
  } catch {
    /* bridge absent */
  }
}

/**
 * Whether the activity is in the system PiP window, read SYNCHRONOUSLY.
 *
 * The `sn:pip` event and the `dataset.snPip` mirror both arrive via an async
 * `evaluateJavascript` from onPictureInPictureModeChanged, which races the
 * WebView's own `visibilitychange`. Anything that has to tell real backgrounding
 * from PiP must not depend on winning that race.
 *
 * Returns null when there is no bridge, so callers can tell "unknown" from
 * "not pipped".
 */
export function isInPip(): boolean | null {
  try {
    const b = bridge();
    if (typeof b?.isInPip === 'function') return b.isInPip();
  } catch {
    /* bridge absent */
  }
  return null;
}

/**
 * True once if the PiP window was CLOSED rather than expanded back into the app.
 *
 * Reading it clears it on the native side. Closing PiP does not finish the
 * activity, so without this the stream stays loaded and comes back the next time
 * the app is opened, which is not what dismissing the window means.
 */
export function consumePipClosed(): boolean {
  try {
    return bridge()?.consumePipClosed?.() ?? false;
  } catch {
    return false;
  }
}

/** Video rect in DEVICE pixels, so the OS animates PiP from the video rather
 *  than cropping and scaling the whole activity. */
export function setPipSourceRect(l: number, t: number, r: number, b: number): void {
  try {
    bridge()?.setPipSourceRect?.(l, t, r, b);
  } catch {
    /* bridge absent */
  }
}

/** Keeps the PiP window's mute RemoteAction showing the right icon. */
export function setPipMuted(muted: boolean): void {
  try {
    bridge()?.setPipMuted?.(muted);
  } catch {
    /* bridge absent */
  }
}

/** Opens the system share sheet. Falls back to the clipboard if unavailable. */
export function shareText(text: string, subject = ''): boolean {
  try {
    const b = bridge();
    if (b?.share) {
      b.share(text, subject);
      return true;
    }
  } catch {
    /* fall through */
  }
  void navigator.clipboard?.writeText(text).catch(() => {});
  return false;
}
