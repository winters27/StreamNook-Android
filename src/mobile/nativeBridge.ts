// Thin wrappers over the MainActivity JavascriptInterface (SNInsets). Every
// call is best-effort: the bridge is absent on desktop and in dev browsers.
interface SNBridge {
  get?(): string;
  setImmersive?(immersive: boolean): void;
  setKeepScreenOn?(on: boolean): void;
  setPipEligible?(eligible: boolean): void;
  enterPip?(): void;
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
