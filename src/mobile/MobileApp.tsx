// Mobile shell root. The phone counterpart of App.tsx: same stores, same
// services, same theme system, phone-shaped chrome (bottom tabs, sheets,
// safe-area frame). Boot orchestration is deliberately replicated, not shared;
// see boot/useMobileBoot.ts for the contract with App.tsx.
import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
import { ActivityScreen } from './screens/ActivityScreen';
import LoadingWidget from '../components/LoadingWidget';
import DeviceLoginOverlay from '../components/DeviceLoginOverlay';
import ToastManager from '../components/ToastManager';

const TAB_ORDER = ['following', 'browse', 'activity', 'you'] as const;

const MobileApp: React.FC = () => {
  useThemeBoot();
  useMobileBoot();
  useKeyboardInsets();

  const isBooting = useAppStore((s) => s.isBooting);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const activeTab = useMobileNavStore((s) => s.activeTab);

  // Slide direction for the tab transition: toward the newly selected tab.
  // Adjust-state-during-render idiom (no refs in render, no extra effect pass).
  const tabIndex = TAB_ORDER.indexOf(activeTab);
  const [prevTabIndex, setPrevTabIndex] = React.useState(tabIndex);
  const [direction, setDirection] = React.useState(1);
  if (prevTabIndex !== tabIndex) {
    setDirection(tabIndex >= prevTabIndex ? 1 : -1);
    setPrevTabIndex(tabIndex);
  }

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
            className="flex-1 min-h-0 flex flex-col relative overflow-hidden"
            style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
          >
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
              <motion.div
                key={activeTab}
                className="flex-1 min-h-0 flex flex-col"
                initial={{ opacity: 0, x: 28 * direction }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 * direction }}
                transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              >
                {activeTab === 'following' && <FollowingScreen />}
                {activeTab === 'browse' && <BrowseScreen />}
                {activeTab === 'activity' && <ActivityScreen />}
                {activeTab === 'you' && <YouScreen />}
              </motion.div>
            </AnimatePresence>
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
