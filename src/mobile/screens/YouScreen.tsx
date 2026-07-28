// The You tab: account header + entry points. Cosmetics equip and full profile
// arrive with the profile phase; this covers identity, settings, and sign-out.
import React, { useState } from 'react';
import { CaretRight, Gear, SignOut } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';

export const YouScreen: React.FC = () => {
  const currentUser = useAppStore((s) => s.currentUser);
  const signOutActiveAccount = useAppStore((s) => s.signOutActiveAccount);
  const openSettings = useMobileNavStore((s) => s.openSettings);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  return (
    <div className="sn-mobile-screen">
      <div className="flex items-center gap-3 px-4 pt-4 pb-4">
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

      <div className="px-3">
        <button
          onClick={() => openSettings()}
          className="w-full flex items-center gap-3 px-3 py-3.5 rounded-lg active:bg-surface-active text-left"
        >
          <Gear size={21} className="text-textSecondary shrink-0" />
          <span className="flex-1 text-[15px] font-medium text-textPrimary">Settings</span>
          <CaretRight size={16} className="text-textMuted shrink-0" />
        </button>
        <button
          onClick={() => {
            if (!confirmSignOut) {
              setConfirmSignOut(true);
              setTimeout(() => setConfirmSignOut(false), 3000);
              return;
            }
            void signOutActiveAccount();
          }}
          className="w-full flex items-center gap-3 px-3 py-3.5 rounded-lg active:bg-surface-active text-left"
        >
          <SignOut size={21} className="text-error shrink-0" />
          <span className="flex-1 text-[15px] font-medium text-error">
            {confirmSignOut ? 'Tap again to sign out' : 'Sign out'}
          </span>
        </button>
      </div>
    </div>
  );
};
