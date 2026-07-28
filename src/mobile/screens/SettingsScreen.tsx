// Full-screen settings drill-in: list first, then the chosen tab's panel.
// Reuses the existing desktop panel components inside a phone-shaped container
// (no modal, no 240px sidebar, no compact-window sizing). Only tabs that make
// sense on a phone are listed; the desktop-only ones (Overlay, MultiNook,
// Keybindings, Plugins, Backup, Command Palette, Moderation, Interface) are not.
import React, { Suspense, lazy } from 'react';
import { ArrowLeft, Bell, ChevronRight, Database, HelpCircle, MessageSquare, Palette, PlayCircle, Sparkles } from 'lucide-react';
import { useMobileNavStore } from '../navStore';

const PANELS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  Player: lazy(() => import('../../components/settings/PlayerSettings')),
  Chat: lazy(() => import('../../components/settings/ChatSettings')),
  Theme: lazy(() => import('../../components/settings/ThemeSettings')),
  Notifications: lazy(() => import('../../components/settings/NotificationsSettings')),
  Cache: lazy(() => import('../../components/settings/CacheSettings')),
  Support: lazy(() => import('../../components/settings/SupportSettings')),
  "What's New": lazy(() => import('../../components/settings/WhatsNewSettings')),
};

const ROWS: { id: keyof typeof PANELS; label: string; icon: typeof Bell; description: string }[] = [
  { id: 'Player', label: 'Player', icon: PlayCircle, description: 'Video quality, latency, and behavior' },
  { id: 'Chat', label: 'Chat', icon: MessageSquare, description: 'Chat design and behavior' },
  { id: 'Theme', label: 'Theme', icon: Palette, description: 'Color theme, glass, and fonts' },
  { id: 'Notifications', label: 'Notifications', icon: Bell, description: 'Alerts and sounds' },
  { id: 'Cache', label: 'Cache', icon: Database, description: 'Emote, badge, and metadata caches' },
  { id: 'Support', label: 'Support', icon: HelpCircle, description: 'Logs, diagnostics, and feedback' },
  { id: "What's New", label: "What's New", icon: Sparkles, description: 'Recent releases' },
];

export const SettingsScreen: React.FC = () => {
  const settingsView = useMobileNavStore((s) => s.settingsView);
  const openSettings = useMobileNavStore((s) => s.openSettings);
  const closeSettings = useMobileNavStore((s) => s.closeSettings);

  if (!settingsView) return null;

  if (settingsView === 'list') {
    return (
      <div
        className="absolute inset-0 z-50 bg-background flex flex-col"
        style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
      >
        <div className="flex items-center gap-1 px-2 py-2 shrink-0">
          <button
            onClick={closeSettings}
            className="sn-touch flex items-center justify-center text-textSecondary"
            aria-label="Back"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-xl font-bold text-textPrimary">Settings</h1>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4">
          {ROWS.map(({ id, label, icon: Icon, description }) => (
            <button
              key={id}
              onClick={() => openSettings(id)}
              className="w-full flex items-center gap-3 px-3 py-3.5 rounded-lg active:bg-surface-active text-left"
            >
              <Icon size={21} className="text-textSecondary shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-medium text-textPrimary">{label}</span>
                <span className="block text-[13px] text-textMuted truncate">{description}</span>
              </span>
              <ChevronRight size={16} className="text-textMuted shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const Panel = PANELS[settingsView];
  return (
    <div
      className="absolute inset-0 z-50 bg-background flex flex-col"
      style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
    >
      <div className="flex items-center gap-1 px-2 py-2 shrink-0 border-b border-borderSubtle">
        <button
          onClick={() => openSettings('list')}
          className="sn-touch flex items-center justify-center text-textSecondary"
          aria-label="Back to settings"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold text-textPrimary">{settingsView}</h1>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
        style={{ paddingBottom: 'calc(var(--sn-safe-b, 0px) + 16px)' }}
      >
        {Panel ? (
          <Suspense fallback={<div className="py-10 text-center text-sm text-textMuted">Loading…</div>}>
            <Panel />
          </Suspense>
        ) : (
          <div className="py-10 text-center text-sm text-textMuted">Unknown section.</div>
        )}
      </div>
    </div>
  );
};
