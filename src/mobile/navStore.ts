// Mobile navigation state: active bottom tab, sheet stack, the settings
// drill-in, and the Android back-button chain. The native side (MainActivity
// OnBackPressedCallback) calls window.__SN_BACK__(); a `true` return means the
// web layer consumed the press, `false` means native should moveTaskToBack
// (background, never kill).
import { create } from 'zustand';
import { useAppStore } from '../stores/AppStore';
import type { TwitchCategory } from '../types';

export type MobileTab = 'following' | 'browse' | 'activity' | 'you';

export const DEFAULT_TAB: MobileTab = 'following';

interface MobileNavState {
  activeTab: MobileTab;
  /** Open sheet ids, bottom-most first. Sheets self-register on open. */
  sheetStack: string[];
  /** Settings panel: the open tab id, or null (the section list lives on You). */
  settingsView: string | null;
  /** Browse category drill: the open category's streams screen, or null. */
  browseCategory: TwitchCategory | null;
  /** The cosmetics (equip) screen. */
  cosmeticsOpen: boolean;
  setTab: (tab: MobileTab) => void;
  pushSheet: (id: string) => void;
  popSheet: (id?: string) => void;
  openSettings: (tab: string) => void;
  closeSettings: () => void;
  openBrowseCategory: (category: TwitchCategory | null) => void;
  setCosmeticsOpen: (open: boolean) => void;
  /** Back chain: top sheet -> settings tab -> settings list -> exit stream ->
   *  non-default tab -> not consumed (native backgrounds the task). */
  handleBack: () => boolean;
}

export const useMobileNavStore = create<MobileNavState>((set, get) => ({
  activeTab: DEFAULT_TAB,
  sheetStack: [],
  settingsView: null,
  browseCategory: null,
  cosmeticsOpen: false,

  setTab: (tab) => set({ activeTab: tab }),

  pushSheet: (id) =>
    set((s) => (s.sheetStack.includes(id) ? s : { sheetStack: [...s.sheetStack, id] })),

  popSheet: (id) =>
    set((s) => ({
      sheetStack: id ? s.sheetStack.filter((x) => x !== id) : s.sheetStack.slice(0, -1),
    })),

  openSettings: (tab) => set({ settingsView: tab }),
  closeSettings: () => set({ settingsView: null }),
  openBrowseCategory: (category) => set({ browseCategory: category }),
  setCosmeticsOpen: (open) => set({ cosmeticsOpen: open }),

  handleBack: () => {
    const { sheetStack, activeTab, settingsView, browseCategory, cosmeticsOpen } = get();
    if (sheetStack.length > 0) {
      const top = sheetStack[sheetStack.length - 1];
      window.dispatchEvent(new CustomEvent('sn:close-sheet', { detail: top }));
      return true;
    }
    if (settingsView) {
      set({ settingsView: null });
      return true;
    }
    if (cosmeticsOpen) {
      set({ cosmeticsOpen: false });
      return true;
    }
    const app = useAppStore.getState();
    if (app.streamUrl || app.isLoading) {
      void app.exitStream();
      return true;
    }
    if (browseCategory) {
      set({ browseCategory: null });
      return true;
    }
    if (activeTab !== DEFAULT_TAB) {
      set({ activeTab: DEFAULT_TAB });
      return true;
    }
    return false;
  },
}));

/** Installed once by MobileApp; consumed by the native back callback. */
export function installBackHandler(): () => void {
  const w = window as Window & { __SN_BACK__?: () => boolean };
  w.__SN_BACK__ = () => useMobileNavStore.getState().handleBack();
  return () => {
    delete w.__SN_BACK__;
  };
}
