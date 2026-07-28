// Single source of truth for which shell this window renders. Resolved once at
// module load: `platform()` is synchronous in Tauri v2 (tauri-plugin-os is
// registered on every target). The UA sniff is only a safety net for the case
// where the os plugin's ACL permission is missing or the call throws.
import { platform } from '@tauri-apps/plugin-os';

function detectMobile(): boolean {
  try {
    const p = platform();
    return p === 'android' || p === 'ios';
  } catch {
    return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  }
}

export const isMobile: boolean = detectMobile();
export const isDesktop: boolean = !isMobile;
