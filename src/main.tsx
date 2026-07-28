import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { MotionScope } from './components/MotionScope.tsx';

// Route components are lazy so each window only downloads/parses the code it
// actually renders. The MultiChat / profile / plugin popouts no longer pull in
// App's whole tree (video player + hls.js/plyr, browse, settings) — a real
// footprint + startup cut for the chat-only popout.
const App = lazy(() => import('./App.tsx'));
const MobileApp = lazy(() => import('./mobile/MobileApp.tsx'));
const ProfileCardPage = lazy(() => import('./pages/ProfileCardPage.tsx'));
const MultiChatWindow = lazy(() => import('./components/multichat/MultiChatWindow.tsx'));
const PluginWindowHost = lazy(() => import('./plugins-ui/PluginWindowHost.tsx'));
// Popout-window and tray plumbing. These used to be unconditional side-effect
// imports, so they registered at module load on Android too, where there is no
// tray and WebviewWindow.create() throws. Desktop-only now; the microtask delay
// is irrelevant because both are driven by later user interaction.
if (!IS_MOBILE) {
  // registers `window.openMultiChatWindow` for popout spawning
  import('./utils/multichatWindow');
  // listens for the tray's "Open MultiChat" menu event
  import('./utils/multichatTrayBridge');
}
// Fraunces (variable serif). Italic powers the StreamNook tier-badge rank
// number; the upright axis backs the "Serif" choice in Theme > Font.
import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
// Plyr's CSS must load BEFORE globals.css: our `.video-player-container .plyr__*`
// overrides have EQUAL specificity to Plyr's own defaults, so whichever stylesheet
// loads last wins. The video player is lazy-loaded, so without this eager import
// Plyr's CSS injects AFTER globals.css at runtime and its default (tall, gradient)
// control bar overrides our styled one. Eager-importing it here (deduped with the
// lazy player's own import) restores the pre-lazy-load order so our overrides win.
import 'plyr/dist/plyr.css';
import './styles/globals.css';
// Mobile layout layer. Every rule is scoped behind html[data-mobile="true"],
// which is set just below, so importing it on desktop is inert.
import './styles/mobile.css';
import { initLogCapture } from './services/logService';
import { IS_MOBILE, isPortrait, onOrientationChange } from './utils/platform';

// Drive the mobile CSS off the document element. Orientation is tracked here
// rather than with a CSS media query because the layout branch also needs it in
// JS (the player switches between a fixed 16:9 band and full-bleed).
if (IS_MOBILE) {
  const root = document.documentElement;
  root.dataset.mobile = 'true';
  const applyOrientation = () => {
    root.dataset.orientation = isPortrait() ? 'portrait' : 'landscape';
  };
  applyOrientation();
  onOrientationChange(applyOrientation);
  // Android back-button chain for the in-place shell (MainActivity calls
  // window.__SN_BACK__). MobileApp overrides this with navStore on mount.
  void import('./mobile/inPlaceBack').then((m) => m.installInPlaceBackHandler());
  // Pull the native WindowInsets into --sn-inset-* CSS vars. The push from
  // MainActivity fires on inset CHANGES, which a fresh page load missed, and
  // env(safe-area-inset-*) reads 0 in this WebView, so without this pull the
  // UI draws under the status bar and camera cutout on every boot.
  void import('./mobile/nativeInsets').then((m) => m.applyNativeInsetsOnce());
}

import { Logger } from './utils/logger';
// Initialize log capture early to capture all console messages
initLogCapture();
Logger.debug('[App] StreamNook starting...');

// Remove Plyr's localStorage - we manage player settings via Tauri backend
// Plyr has built-in localStorage persistence that conflicts with our settings management
localStorage.removeItem('plyr');

// Route based on URL hash. Profile-card windows, the StreamNook MultiChat
// popout, and ui-plugin popout windows share the same bundle as the main App;
// main.tsx picks the root component to render.
const hash = window.location.hash;
const isProfileCard = hash.startsWith('#/profile');
const isMultiChat = hash.startsWith('#/multichat');
const isPluginWindow = hash.startsWith('#/plugin/');

// The dedicated mobile shell (src/mobile/: bottom tabs, sheets, touch player,
// drill-in settings) is the mobile DEFAULT. The in-place adapted App
// (data-mobile CSS + MobileNav) remains reachable as an escape hatch: set
// localStorage['sn-legacy-shell'] = '1' on a device build to fall back.
const useNextMobileShell = IS_MOBILE && localStorage.getItem('sn-legacy-shell') !== '1';

// Create the React root ONCE per container. The lazy route imports above can make
// React Fast Refresh re-execute this module instead of full-reloading, and a second
// createRoot() on the same #root mounts a competing React tree — which manifests as
// the "createRoot() on a container that has already been passed" warning AND erratic
// freezes (two roots fighting over the same DOM, e.g. a clip modal locking up).
// Caching the root on the container makes re-execution a re-render, not a new root.
const container = document.getElementById('root') as HTMLElement & {
  __snRoot?: ReactDOM.Root;
};
const root = container.__snRoot ?? (container.__snRoot = ReactDOM.createRoot(container));
root.render(
  <React.StrictMode>
    <MotionScope>
      <Suspense fallback={null}>
        {isMultiChat ? <MultiChatWindow /> : isPluginWindow ? <PluginWindowHost /> : isProfileCard ? <ProfileCardPage /> : useNextMobileShell ? <MobileApp /> : <App />}
      </Suspense>
    </MotionScope>
  </React.StrictMode>,
);
