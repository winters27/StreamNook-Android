// Thin wrappers over the MainActivity JavascriptInterface (SNInsets). Every
// call is best-effort: the bridge is absent on desktop and in dev browsers.
interface SNBridge {
  get?(): string;
  setImmersive?(immersive: boolean): void;
  setKeepScreenOn?(on: boolean): void;
  setPipEligible?(eligible: boolean): void;
  enterPip?(): void;
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
