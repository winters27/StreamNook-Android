// Mobile notification settings.
//
// The desktop panel is built around in-window delivery (toasts, the Dynamic
// Island, positioning and edge offsets), none of which exist on a phone: the
// system shade is the only surface that works when the app is backgrounded.
// So this is its own panel over the SAME persisted settings fields, exposing
// permission plus what is worth being interrupted for.
import React, { useCallback, useEffect, useState } from 'react';
import { BellSimple } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import {
  ensureNotificationPermission,
  isNotificationPermissionGranted,
  postSystemNotification,
} from '../notifications';
import type { LiveNotificationSettings } from '../../types';

const TOGGLES: {
  key: keyof LiveNotificationSettings;
  label: string;
  description: string;
}[] = [
  {
    key: 'show_live_notifications',
    label: 'Channels going live',
    description: 'Alert when a channel you follow starts streaming',
  },
  {
    key: 'show_drops_notifications',
    label: 'Drops',
    description: 'Campaign progress and claimable rewards',
  },
  {
    key: 'show_badge_notifications',
    label: 'New badges',
    description: 'When a new global badge becomes available',
  },
  {
    key: 'show_whisper_notifications',
    label: 'Whispers',
    description: 'Direct messages sent to you',
  },
  {
    key: 'show_channel_points_notifications',
    label: 'Channel points',
    description: 'Bonus chests claimed while you watch',
  },
];

const Toggle: React.FC<{ on: boolean; onChange: () => void }> = ({ on, onChange }) => (
  <button
    onClick={onChange}
    role="switch"
    aria-checked={on}
    className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${
      on ? 'bg-accent' : 'bg-surface'
    }`}
  >
    <span
      className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-[left]"
      style={{ left: on ? 22 : 2 }}
    />
  </button>
);

const MobileNotificationsSettings: React.FC = () => {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void isNotificationPermissionGranted().then(setGranted);
  }, []);

  const prefs: Partial<LiveNotificationSettings> = settings.live_notifications ?? {};

  const setPref = useCallback(
    async (key: keyof LiveNotificationSettings, value: boolean) => {
      const current = settings.live_notifications;
      if (!current) return;
      await updateSettings({
        ...settings,
        live_notifications: {
          ...current,
          [key]: value,
          // On mobile the system shade IS the delivery surface, so keep the
          // native flag on whenever any category is enabled.
          use_native_notifications: true,
        },
      });
    },
    [settings, updateSettings],
  );

  const requestPermission = async () => {
    const ok = await ensureNotificationPermission();
    setGranted(ok);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Permission state: the gate everything else depends on. */}
      <div className="glass-panel p-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          <BellSimple size={17} className="text-accent" />
          <span className="text-[14.5px] font-semibold text-textPrimary">
            System notifications
          </span>
        </div>
        {granted ? (
          <p className="text-[12.5px] text-textSecondary leading-relaxed">
            StreamNook can post to your notification shade. Alerts arrive even when the app is
            closed.
          </p>
        ) : (
          <>
            <p className="text-[12.5px] text-textSecondary leading-relaxed mb-2.5">
              Allow notifications so alerts reach you when StreamNook is in the background.
            </p>
            <button
              onClick={() => void requestPermission()}
              className="glass-button sn-touch w-full text-[13.5px] font-semibold text-textPrimary"
            >
              {granted === false ? 'Enable notifications' : 'Allow notifications'}
            </button>
          </>
        )}
      </div>

      <div>
        <div className="text-[12px] font-semibold text-textMuted uppercase tracking-wide mb-1.5 px-1">
          Notify me about
        </div>
        <div className="glass-panel divide-y divide-borderSubtle">
          {TOGGLES.map(({ key, label, description }) => {
            const on = prefs[key] !== false;
            return (
              <div key={key} className="flex items-center gap-3 p-3.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-textPrimary">{label}</div>
                  <div className="text-[12px] text-textMuted leading-snug mt-0.5">
                    {description}
                  </div>
                </div>
                <Toggle on={on} onChange={() => void setPref(key, !on)} />
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={() =>
          void postSystemNotification({
            title: 'StreamNook',
            body: 'Notifications are working.',
          })
        }
        className="glass-button sn-touch w-full text-[13.5px] font-medium text-textSecondary"
      >
        Send a test notification
      </button>
    </div>
  );
};

export default MobileNotificationsSettings;
