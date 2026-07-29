// Mobile shell root. The phone counterpart of App.tsx: same stores, same
// services, same theme system, phone-shaped chrome (bottom tabs, sheets,
// safe-area frame). Boot orchestration is deliberately replicated, not shared;
// see boot/useMobileBoot.ts for the contract with App.tsx.
import React, { useEffect } from 'react';
import './mobile.css';
import { useAppStore } from '../stores/AppStore';
import { applyNativeInsetsOnce } from './nativeInsets';
import { useThemeBoot } from '../boot/useThemeBoot';
import { useMobileBoot } from './boot/useMobileBoot';
import { useKeyboardInsets } from './ui/useKeyboardInsets';
import { installBackHandler, useMobileNavStore } from './navStore';
import { MobileTabBar } from './MobileTabBar';
import { MobileOnboarding } from './MobileOnboarding';
import { FollowingScreen } from './screens/FollowingScreen';
import { BrowseScreen } from './screens/BrowseScreen';
import { YouScreen } from './screens/YouScreen';
import { WatchScreen } from './screens/WatchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CategoryStreamsScreen } from './screens/CategoryStreamsScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import LoadingWidget from '../components/LoadingWidget';
import DeviceLoginOverlay from '../components/DeviceLoginOverlay';
import ToastManager from '../components/ToastManager';

const MobileApp: React.FC = () => {
  useThemeBoot();
  useMobileBoot();
  useKeyboardInsets();

  const isBooting = useAppStore((s) => s.isBooting);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const activeTab = useMobileNavStore((s) => s.activeTab);

  useEffect(() => installBackHandler(), []);
  useEffect(() => {
    applyNativeInsetsOnce();
  }, []);

  return (
    <div className="sn-mobile bg-background text-textPrimary">
      {isBooting ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <LoadingWidget fullScreen={false} message="Loading StreamNook" />
        </div>
      ) : !isAuthenticated ? (
        <MobileOnboarding />
      ) : (
        <>
          <div
            className="flex-1 min-h-0 flex flex-col relative"
            style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
          >
            {activeTab === 'following' && <FollowingScreen />}
            {activeTab === 'browse' && <BrowseScreen />}
            {activeTab === 'activity' && <PlaceholderScreen title="Activity" />}
            {activeTab === 'you' && <YouScreen />}
          </div>
          {/* Floating pill bar (fixed) and the full-screen layers above it. */}
          <MobileTabBar />
          <CategoryStreamsScreen />
          <WatchScreen />
          <SettingsScreen />
        </>
      )}

      {/* Always mounted: device-code login fallback + toasts. */}
      <DeviceLoginOverlay />
      <ToastManager />
    </div>
  );
};

export default MobileApp;
