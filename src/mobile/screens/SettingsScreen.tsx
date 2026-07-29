// Full-screen settings panel host. The section list lives inline on the You
// tab; this screen renders one tab's panel with a back header. Reuses the
// existing desktop panel components in a phone-shaped container.
import React, { Suspense, lazy } from 'react';
import { ArrowLeft, Bell, Database, HelpCircle, MessageSquare, Palette, PlayCircle, Sparkles } from 'lucide-react';
import { useMobileNavStore } from '../navStore';

const PANELS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  Player: lazy(() => import('../../components/settings/PlayerSettings')),
  Chat: lazy(() => import('../../components/settings/ChatSettings')),
  Theme: lazy(() => import('../../components/settings/ThemeSettings')),
  // Mobile gets its own notifications panel: the desktop one configures
  // toasts and the Dynamic Island, which do not exist here.
  Notifications: lazy(() => import('./MobileNotificationsSettings')),
  Cache: lazy(() => import('../../components/settings/CacheSettings')),
  Support: lazy(() => import('../../components/settings/SupportSettings')),
  "What's New": lazy(() => import('../../components/settings/WhatsNewSettings')),
};

// The section rows the You tab renders inline. Kept beside PANELS so a new
// panel and its row cannot drift apart.
export const SETTINGS_ROWS: {
  id: keyof typeof PANELS;
  label: string;
  icon: typeof Bell;
  description: string;
}[] = [
  { id: 'Player', label: 'Player', icon: PlayCircle, description: 'Video quality, latency, and behavior' },
  { id: 'Chat', label: 'Chat', icon: MessageSquare, description: 'Chat design and behavior' },
  { id: 'Theme', label: 'Theme', icon: Palette, description: 'Color theme, glass, and fonts' },
  {
    id: 'Notifications',
    label: 'Notifications',
    icon: Bell,
    description: 'System alerts for live channels and drops',
  },
  { id: 'Cache', label: 'Cache', icon: Database, description: 'Emote, badge, and metadata caches' },
  { id: 'Support', label: 'Support', icon: HelpCircle, description: 'Logs, diagnostics, and feedback' },
  { id: "What's New", label: "What's New", icon: Sparkles, description: 'Recent releases' },
];

export const SettingsScreen: React.FC = () => {
  const settingsView = useMobileNavStore((s) => s.settingsView);
  const closeSettings = useMobileNavStore((s) => s.closeSettings);

  if (!settingsView) return null;

  const Panel = PANELS[settingsView];
  return (
    <div
      className="absolute inset-0 z-50 bg-background flex flex-col"
      style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
    >
      <div className="flex items-center gap-1 px-2 py-2 shrink-0 border-b border-borderSubtle">
        <button
          onClick={closeSettings}
          className="sn-touch flex items-center justify-center text-textSecondary"
          aria-label="Back"
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
