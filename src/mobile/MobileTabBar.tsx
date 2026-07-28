import React from 'react';
import { Compass, Gift, Heart, UserCircle } from 'phosphor-react';
import { useMobileNavStore, type MobileTab } from './navStore';

const TABS: { id: MobileTab; label: string; Icon: typeof Heart }[] = [
  { id: 'following', label: 'Following', Icon: Heart },
  { id: 'browse', label: 'Browse', Icon: Compass },
  { id: 'activity', label: 'Activity', Icon: Gift },
  { id: 'you', label: 'You', Icon: UserCircle },
];

export const MobileTabBar: React.FC = () => {
  const activeTab = useMobileNavStore((s) => s.activeTab);
  const setTab = useMobileNavStore((s) => s.setTab);

  return (
    <nav
      className="shrink-0 border-t border-borderSubtle bg-background-secondary/95"
      style={{
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        paddingBottom: 'var(--sn-safe-b, 0px)',
        paddingLeft: 'var(--sn-safe-l, 0px)',
        paddingRight: 'var(--sn-safe-r, 0px)',
      }}
    >
      <div className="flex" style={{ height: 'var(--sn-tabbar-h, 56px)' }}>
        {TABS.map(({ id, label, Icon }) => {
          const active = id === activeTab;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`sn-touch flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-accent' : 'text-textMuted'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={22} weight={active ? 'fill' : 'regular'} />
              <span className="text-[11px] leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
