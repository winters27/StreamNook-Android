// Tap-a-username sheet: identity summary with the chatter's cosmetics (7TV
// paint on the name via the shared chatUserStore read path). The full profile
// card comes with the profile phase; this covers the immediate tap intent.
import React from 'react';
import { useChatUserStore } from '../../stores/chatUserStore';
import { computePaintStyle } from '../../services/seventvService';
import { MobileSheet } from '../ui/MobileSheet';

export interface SheetUser {
  userId: string;
  username: string;
  displayName: string;
  color: string;
}

export const UserSheet: React.FC<{ user: SheetUser | null; onClose: () => void }> = ({
  user,
  onClose,
}) => {
  const storeUser = useChatUserStore((s) => (user ? s.users.get(user.userId) : undefined));

  if (!user) return null;

  const paint = storeUser?.paint;
  const nameStyle = paint
    ? computePaintStyle(paint, user.color || '#9147FF', 'all')
    : { color: user.color || '#9147FF' };

  return (
    <MobileSheet open={!!user} onClose={onClose} maxHeightFraction={0.4}>
      <div className="flex flex-col items-center pt-1 pb-2">
        <div className="text-lg font-bold" style={nameStyle}>
          {user.displayName}
        </div>
        {user.displayName.toLowerCase() !== user.username.toLowerCase() && (
          <div className="text-[13px] text-textMuted mt-0.5">@{user.username}</div>
        )}
        {storeUser?.seventvBadge?.name && (
          <div className="text-[13px] text-textSecondary mt-2">
            7TV badge: {storeUser.seventvBadge.name}
          </div>
        )}
      </div>
    </MobileSheet>
  );
};
