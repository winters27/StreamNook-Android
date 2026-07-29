// The You tab: account header, settings sections inline (no intermediate
// menu), sign out at the very bottom.
import React, { useState } from 'react';
import { SignOut } from 'phosphor-react';
import { ChevronRight } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import { SETTINGS_ROWS } from './SettingsScreen';

export const YouScreen: React.FC = () => {
  const currentUser = useAppStore((s) => s.currentUser);
  const signOutActiveAccount = useAppStore((s) => s.signOutActiveAccount);
  const openSettings = useMobileNavStore((s) => s.openSettings);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  return (
    <div className="sn-mobile-screen sn-tabbar-clearance">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        {currentUser?.profile_image_url ? (
          <img
            src={currentUser.profile_image_url}
            alt=""
            className="w-14 h-14 rounded-full"
            draggable={false}
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-surface" />
        )}
        <div className="min-w-0">
          <div className="text-lg font-bold text-textPrimary truncate">
            {currentUser?.display_name || currentUser?.username || 'Signed in'}
          </div>
          {currentUser?.login && (
            <div className="text-[13px] text-textMuted truncate">@{currentUser.login}</div>
          )}
        </div>
      </div>

      <div className="text-[12px] font-semibold text-textMuted uppercase tracking-wide px-4 mb-1">
        Settings
      </div>
      <div className="px-3">
        {SETTINGS_ROWS.map(({ id, label, icon: Icon, description }) => (
          <button
            key={id}
            onClick={() => openSettings(id)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg active:bg-surface-active text-left"
          >
            <Icon size={20} className="text-textSecondary shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-medium text-textPrimary">{label}</span>
              <span className="block text-[12.5px] text-textMuted truncate">{description}</span>
            </span>
            <ChevronRight size={16} className="text-textMuted shrink-0" />
          </button>
        ))}

        <button
          onClick={() => {
            if (!confirmSignOut) {
              setConfirmSignOut(true);
              setTimeout(() => setConfirmSignOut(false), 3000);
              return;
            }
            void signOutActiveAccount();
          }}
          className="w-full flex items-center gap-3 px-3 py-3.5 mt-4 rounded-lg active:bg-surface-active text-left"
        >
          <SignOut size={20} className="text-error shrink-0" />
          <span className="flex-1 text-[15px] font-medium text-error">
            {confirmSignOut ? 'Tap again to sign out' : 'Sign out'}
          </span>
        </button>
      </div>
    </div>
  );
};
