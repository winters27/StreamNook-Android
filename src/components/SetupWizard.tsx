import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Check,
    ExternalLink,
    ChevronLeft,
    Loader2,
    User,
    Package,
    AlertCircle,
    MessageCircle,
    Wand2,
    CheckCircle2,
    Palette,
    Bell,
    PanelTop,
    MessageSquare,
    Layers,
    Columns,
    Eye,
    EyeOff,
    X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { IS_MOBILE } from '../utils/platform';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../stores/AppStore';
import streamnookLogo from '../assets/streamnook-logo.png';
import {
    themes,
    applyTheme,
    getThemeById,
    getOledTheme,
    OLED_THEME_ID,
    DEFAULT_THEME_ID,
    type Theme,
} from '../themes';
import { getSidebarSettings, saveSidebarSettings, type SidebarMode } from './settings/InterfaceSettings';

import { Logger } from '../utils/logger';
import { ANNOUNCEMENTS_BASELINE_PENDING_KEY } from './AnnouncementsBanner';

const STEP_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const STEP_DURATION = 0.4;
const STEP_COUNT = 9;

// Notification delivery surfaces offered on the notification-style step. "Both"
// is just the two booleans on together; the wizard maps each choice onto the
// use_dynamic_island / use_toast pair the rest of the app already reads.
type NotifMode = 'island' | 'toast' | 'both';

interface SetupWizardProps {
    isOpen: boolean;
    onClose: () => void;
}

// Compact theme swatch for the setup grid: the five palette dots plus the name,
// painted on the theme's own background so each card previews itself. Selecting
// one applies it live, so the whole wizard repaints as a full preview.
const WizardThemeCard = ({ theme, selected, onSelect }: { theme: Theme; selected: boolean; onSelect: () => void }) => {
    const { palette } = theme;
    const dots = [palette.accent, palette.highlight.pink, palette.highlight.purple, palette.highlight.blue, palette.highlight.green];
    return (
        <button
            onClick={onSelect}
            className={`relative p-3 rounded-lg border text-left transition-all duration-200 ${selected ? 'border-accent ring-1 ring-accent/30' : 'border-borderSubtle hover:border-borderLight'}`}
            style={{ backgroundColor: palette.background }}
        >
            <div className="flex gap-1.5 mb-2">
                {dots.map((c, i) => (
                    <div key={i} className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: c }} />
                ))}
            </div>
            <div className="text-sm font-semibold truncate" style={{ color: palette.textPrimary }}>
                {theme.name}
            </div>
            {selected && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                    <Check size={12} className="text-background" strokeWidth={3} />
                </div>
            )}
        </button>
    );
};

interface StepStatus {
    componentsInstalled: boolean | null;
    extractionError: string | null;
    dropsAuthenticated: boolean;
    mainAuthenticated: boolean;
}

interface DropsDeviceCodeInfo {
    user_code: string;
    verification_uri: string;
    device_code: string;
    interval: number;
    expires_in: number;
}

const SetupWizard = ({ isOpen, onClose }: SetupWizardProps) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [dropsDeviceCode, setDropsDeviceCode] = useState<DropsDeviceCodeInfo | null>(null);
    const [status, setStatus] = useState<StepStatus>({
        componentsInstalled: null,
        extractionError: null,
        dropsAuthenticated: false,
        mainAuthenticated: false,
    });
    const [error, setError] = useState<string | null>(null);

    const { addToast, settings, updateSettings, isAuthenticated, checkAuthStatus, loginToTwitch, whisperImportState, setWhisperImportState, resetWhisperImportState } = useAppStore();
    const [whisperImportStarted, setWhisperImportStarted] = useState(false);
    const unlistenRefs = useRef<Array<() => void>>([]);

    useEffect(() => {
        return () => {
            unlistenRefs.current.forEach(fn => fn());
            unlistenRefs.current = [];
        };
    }, []);

    const checkComponentsInstalled = useCallback(async () => {
        try {
            const installed = await invoke('check_components_installed') as boolean;
            setStatus(prev => ({ ...prev, componentsInstalled: installed }));
            return installed;
        } catch (e) {
            Logger.error('Failed to check components:', e);
            setStatus(prev => ({ ...prev, componentsInstalled: false }));
            return false;
        }
    }, []);

    const checkDropsAuthStatus = useCallback(async () => {
        try {
            const isDropsAuth = await invoke('is_drops_authenticated') as boolean;
            Logger.debug('[SetupWizard] Drops auth status:', isDropsAuth);
            setStatus(prev => ({ ...prev, dropsAuthenticated: isDropsAuth }));
            return isDropsAuth;
        } catch (e) {
            Logger.error('Failed to check drops auth status:', e);
            setStatus(prev => ({ ...prev, dropsAuthenticated: false }));
            return false;
        }
    }, []);

    const extractComponents = useCallback(async () => {
        setIsExtracting(true);
        setStatus(prev => ({ ...prev, extractionError: null }));
        try {
            await invoke('extract_bundled_components');
            setStatus(prev => ({ ...prev, componentsInstalled: true }));
            addToast('Setup complete!', 'success');
            setCurrentStep(2);
        } catch (e) {
            Logger.error('Failed to extract components:', e);
            const errorMsg = String(e);
            setStatus(prev => ({ ...prev, extractionError: errorMsg }));
            setError(errorMsg);
        } finally {
            setIsExtracting(false);
        }
    }, [settings, updateSettings, addToast]);

    // Initial bundled-component and drops-auth checks fire once per wizard open.
    // Kept off the isAuthenticated dep on purpose: re-running checkComponentsInstalled
    // mid-wizard overwrites a user-picked custom streamlink path (which the bundled
    // check doesn't satisfy), making the Ready step show "skipped" for streamlink even
    // though the user configured it correctly.
    useEffect(() => {
        if (isOpen) {
            checkComponentsInstalled();
            checkDropsAuthStatus();
        }
    }, [isOpen, checkComponentsInstalled, checkDropsAuthStatus]);

    // Mirror auth state into wizard status separately, so signing in doesn't trigger
    // the initial-checks effect above.
    useEffect(() => {
        setStatus(prev => ({ ...prev, mainAuthenticated: isAuthenticated }));
    }, [isAuthenticated]);

    useEffect(() => {
        if (currentStep === 1 && status.componentsInstalled === false && !isExtracting && !status.extractionError) {
            extractComponents();
        } else if (currentStep === 1 && status.componentsInstalled === true) {
            setCurrentStep(2);
        }
    }, [currentStep, status.componentsInstalled, isExtracting, status.extractionError, extractComponents]);

    const openDropsVerificationWindow = useCallback(async (verificationUri: string) => {
        // Desktop opens a Rust-side webview bound to the active account's web
        // profile, so it reuses the main login's twitch.tv session (authorize
        // only, no re-login) and Rust clears any stale window on the fixed label
        // first.
        //
        // That whole login-overlay subsystem is `#[cfg(desktop)]`, so on Android
        // `open_drops_login_window` simply does not exist: the invoke rejected,
        // the catch below logged it, and the step appeared to do nothing at all
        // - no browser, no error. Mobile authorizes in the same in-app login
        // WebView the main Twitch sign-in uses.
        try {
            if (IS_MOBILE) {
                await invoke('open_mobile_login', { url: verificationUri });
            } else {
                await invoke('open_drops_login_window', { url: verificationUri });
            }
        } catch (e) {
            Logger.error('Failed to open drops login window:', e);
        }
    }, []);

    const handleDropsLogin = useCallback(async () => {
        setIsAuthenticating(true);
        setError(null);
        try {
            const deviceInfo = await invoke('start_drops_device_flow') as DropsDeviceCodeInfo;
            setDropsDeviceCode(deviceInfo);

            // The mobile login WebView COVERS the app, so the code has to be on
            // the clipboard before it opens or there is no way to read it off
            // the card underneath.
            if (IS_MOBILE) {
                try {
                    await navigator.clipboard.writeText(deviceInfo.user_code);
                } catch {
                    // The code card is still on screen behind the overlay.
                }
            }

            await openDropsVerificationWindow(deviceInfo.verification_uri);

            try {
                await invoke('poll_drops_token', {
                    deviceCode: deviceInfo.device_code,
                    interval: deviceInfo.interval,
                    expiresIn: deviceInfo.expires_in,
                });

                setStatus(prev => ({ ...prev, dropsAuthenticated: true }));
                setDropsDeviceCode(null);
                addToast('Drops login successful!', 'success');

                // Desktop-only: there is no separate window to raise on a phone,
                // and `focus_window` is part of the same cfg(desktop) subsystem.
                if (!IS_MOBILE) {
                    try {
                        await invoke('focus_window');
                    } catch (focusError) {
                        Logger.error('Failed to focus window:', focusError);
                    }
                }

                setTimeout(() => setCurrentStep(4), 500);
            } catch (pollError) {
                Logger.error('Failed to complete drops login:', pollError);
                setError(`Login failed: ${pollError}`);
                setDropsDeviceCode(null);
            }
        } catch (e) {
            Logger.error('Failed to start drops login:', e);
            setError(`Failed to start login: ${e}`);
        } finally {
            // Close in `finally`, not only on success. The old code dismissed the
            // overlay on the happy path alone, so a failed or expired poll left
            // it sitting over the app with no way back - survivable as a desktop
            // window you can close, not survivable as a full-screen mobile
            // overlay.
            try {
                if (IS_MOBILE) await invoke('close_mobile_login');
                else await invoke('close_login_overlay', { label: 'drops-login' });
            } catch {
                // Already dismissed by the backend on token receipt.
            }
            setIsAuthenticating(false);
        }
    }, [addToast, openDropsVerificationWindow]);

    const handleMainLogin = useCallback(async () => {
        setIsAuthenticating(true);
        setError(null);
        try {
            await loginToTwitch();

            unlistenRefs.current.forEach(fn => fn());
            unlistenRefs.current = [];

            const unlisten = await listen('twitch-login-complete', async () => {
                await checkAuthStatus();
                setStatus(prev => ({ ...prev, mainAuthenticated: true }));
                setIsAuthenticating(false);

                try {
                    await invoke('focus_window');
                } catch (focusError) {
                    Logger.error('Failed to focus window:', focusError);
                }

                setTimeout(() => setCurrentStep(3), 500);

                unlistenRefs.current.forEach(fn => fn());
                unlistenRefs.current = [];
            });
            const unlistenError = await listen('twitch-login-error', (event) => {
                setError(`Login failed: ${event.payload}`);
                setIsAuthenticating(false);
                unlistenRefs.current.forEach(fn => fn());
                unlistenRefs.current = [];
            });

            unlistenRefs.current = [unlisten, unlistenError];
        } catch (e) {
            Logger.error('Failed to start login:', e);
            setError(`Failed to start login: ${e}`);
            setIsAuthenticating(false);
        }
    }, [loginToTwitch, checkAuthStatus]);

    const handleCompleteSetup = useCallback(async () => {
        try {
            // Fresh install (setup wasn't already complete): tell the announcements
            // banner to baseline the current backlog as seen so a brand-new user
            // isn't shown notices meant for existing users. Guarding on the prior
            // value keeps forced-relogin walkthroughs (setup already complete) from
            // wiping announcements those users still need.
            const isFirstTimeSetup = !settings.setup_complete;
            await updateSettings({
                ...settings,
                setup_complete: true,
            });
            // Backstop marker, read by the wizard gate in App.tsx. settings.setup_complete
            // is the source of truth, but on Android it has been observed reverting to
            // false between launches, which reopens the wizard forever and makes the app
            // unusable. Recording completion here too survives that. Key must match
            // SETUP_COMPLETE_MARKER in App.tsx.
            try {
                localStorage.setItem('streamnook-setup-complete', 'true');
            } catch {
                // localStorage unavailable; the settings flag is still the primary path
            }
            if (isFirstTimeSetup) {
                try {
                    localStorage.setItem(ANNOUNCEMENTS_BASELINE_PENDING_KEY, 'true');
                } catch {
                    // localStorage unavailable; worst case they see current announcements once
                }
            }
            onClose();
        } catch (e) {
            Logger.error('Failed to save settings:', e);
            addToast('Failed to save settings', 'error');
        }
    }, [settings, updateSettings, onClose, addToast]);

    // ── Theme step ──────────────────────────────────────────────────────────
    const currentThemeId = settings.theme || DEFAULT_THEME_ID;
    const handleSelectTheme = useCallback((themeId: string) => {
        // OLED resolves through its chosen accent like it does in Theme settings;
        // every other theme is a static entry.
        const theme = themeId === OLED_THEME_ID ? getOledTheme(settings.oled_accent) : getThemeById(themeId);
        if (!theme) return;
        applyTheme(theme);
        updateSettings({ ...settings, theme: themeId });
    }, [settings, updateSettings]);

    // ── Sidebar step ────────────────────────────────────────────────────────
    // Sidebar prefs live in localStorage, not the settings store. Seed from there
    // and write through the shared helper so picking applies live (the Sidebar
    // listens for its change event) and persists.
    const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => getSidebarSettings().mode);
    const handleSelectSidebar = useCallback((mode: SidebarMode) => {
        const current = getSidebarSettings();
        saveSidebarSettings(mode, current.expandOnHover, current.showRecommended);
        setSidebarMode(mode);
    }, []);

    const sidebarOptions: { id: SidebarMode; icon: typeof Columns; label: string; desc: string }[] = [
        { id: 'expanded', icon: Columns, label: 'Expanded', desc: 'Full list with names, games, and viewers.' },
        { id: 'compact', icon: Eye, label: 'Compact', desc: 'Just avatars, expanding on hover.' },
        { id: 'hidden', icon: EyeOff, label: 'Hidden', desc: 'Tucked away until you reach the left edge.' },
        { id: 'disabled', icon: X, label: 'Off', desc: 'No sidebar at all.' },
    ];

    // ── Native notification permission (mobile) ────────────────────────────
    // Android 13+ requires an explicit runtime grant for POST_NOTIFICATIONS, so
    // the wizard asks for it rather than silently failing to notify later.
    const [notifPermission, setNotifPermission] = useState<'default' | 'granted' | 'denied'>('default');
    // NOTE: we deliberately do NOT use @tauri-apps/plugin-notification's JS wrapper
    // here. Its dist-js reads `window.Notification.permission` unconditionally, and
    // Android System WebView does not implement the Web Notifications API, so
    // `window.Notification` is undefined and the wrapper throws
    // ("Cannot read properties of undefined") before it ever reaches Rust.
    // Invoking the plugin command directly skips that broken web path.
    useEffect(() => {
        if (!IS_MOBILE) return;
        let cancelled = false;
        (async () => {
            try {
                const granted = await invoke<boolean>('plugin:notification|is_permission_granted');
                if (!cancelled && granted) setNotifPermission('granted');
            } catch (e) {
                console.error('[SetupWizard] notification permission probe failed:', e);
            }
        })();
        return () => { cancelled = true; };
    }, []);
    const handleRequestNativeNotifications = useCallback(async () => {
        try {
            if (await invoke<boolean>('plugin:notification|is_permission_granted')) {
                setNotifPermission('granted');
                return;
            }
            const result = await invoke<string>('plugin:notification|request_permission');
            setNotifPermission(result === 'granted' ? 'granted' : 'denied');
        } catch (e) {
            // Surface it: silently mapping every failure to "denied" makes a broken
            // plugin registration indistinguishable from the user saying no.
            console.error('[SetupWizard] notification permission request failed:', e);
            setNotifPermission('denied');
        }
    }, []);

    // ── Notification-style step (desktop) ──────────────────────────────────
    const liveNotifications = settings.live_notifications;
    const islandOn = liveNotifications?.use_dynamic_island ?? true;
    const toastOn = liveNotifications?.use_toast ?? true;
    const notifMode: NotifMode = islandOn && toastOn ? 'both' : islandOn ? 'island' : toastOn ? 'toast' : 'both';
    const handleSelectNotif = useCallback((mode: NotifMode) => {
        updateSettings({
            ...settings,
            live_notifications: {
                enabled: true,
                play_sound: true,
                ...liveNotifications,
                use_dynamic_island: mode !== 'toast',
                use_toast: mode !== 'island',
            },
        });
    }, [settings, liveNotifications, updateSettings]);

    const notifOptions: { id: NotifMode; icon: typeof Bell; label: string; desc: string }[] = [
        { id: 'island', icon: PanelTop, label: 'Dynamic Island', desc: 'A pill at the top that expands with the details.' },
        { id: 'toast', icon: MessageSquare, label: 'Toast popups', desc: 'Cards that slide in at a screen corner you pick.' },
        { id: 'both', icon: Layers, label: 'Both', desc: 'Every alert in the island and as a toast.' },
    ];

    // Per-step primary CTA that lives bottom-right. null hides it entirely.
    const primaryAction: { label: string; onClick: () => void; disabled?: boolean } | null = (() => {
        switch (currentStep) {
            case 0:
                return { label: 'Get started', onClick: () => setCurrentStep(1) };
            case 1:
                return null;
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 7:
                return { label: 'Continue', onClick: () => setCurrentStep(stepAfter(currentStep)) };
            case 8:
                return { label: 'Start watching', onClick: handleCompleteSetup };
            default:
                return null;
        }
    })();

    // Steps that configure or use something a phone does not have.
    //
    //  4 - whisper history import. It runs the whisper SCRAPER, and
    //      `scrape_whispers` / `receive_whisper_export` are `#[cfg(desktop)]`
    //      (they drive a hidden webview). The step therefore could not do
    //      anything on Android except fail, which is exactly what it did.
    //  6 - sidebar mode (expanded/compact/hidden/off). The Sidebar is gated off
    //      entirely on mobile, so this asks about a surface that never renders.
    //
    // Deliberately NOT skipped: step 1 (components) is a no-op on both platforms
    // now that the client is self-contained - `check_components_installed`
    // always returns true and the step auto-advances. Step 7 (notifications) is
    // not skipped either; it branches on IS_MOBILE to ask for the real Android
    // notification permission instead of offering Dynamic Island vs toast.
    const MOBILE_SKIPPED_STEPS = new Set([4, 6]);
    const stepAfter = (s: number) => {
        let n = s + 1;
        if (IS_MOBILE) while (MOBILE_SKIPPED_STEPS.has(n)) n += 1;
        return n;
    };
    const stepBefore = (s: number) => {
        let n = s - 1;
        if (IS_MOBILE) while (MOBILE_SKIPPED_STEPS.has(n)) n -= 1;
        return n;
    };
    // Dots must reflect the steps this platform actually shows, otherwise mobile
    // renders an indicator for a page it can never land on.
    const visibleSteps = Array.from({ length: STEP_COUNT }, (_, i) => i).filter(
        (i) => !(IS_MOBILE && MOBILE_SKIPPED_STEPS.has(i)),
    );

    const canGoBack = currentStep > 1 && currentStep < 8;

    // Swipe navigation (mobile). The step dots already imply a swipeable carousel,
    // so a Continue button on every step was both redundant and un-native.
    //
    // Forward swipe is allowed only where advancing is pure navigation. Step 1 runs
    // the component extraction and advances itself when that finishes, so swiping
    // past it would skip a required step; step 8 commits setup, which should stay a
    // deliberate tap rather than something you can trigger with a stray flick.
    const canSwipeForward = currentStep === 0 || (currentStep >= 2 && currentStep <= 7);
    // Timestamp of the last swipe-driven step change, used to swallow swipes that
    // arrive while the exit animation is still running.
    const lastStepChangeRef = useRef(0);
    // Buttons survive on the bookends only: the opening call to action (which also
    // teaches that this flow is tappable) and the final commit.
    const showPrimaryOnMobile = currentStep === 0 || currentStep === 8;

    const renderStepContent = () => {
        switch (currentStep) {
            case 0:
                return (
                    <>
                        <img
                            src={streamnookLogo}
                            alt=""
                            className="h-28 w-auto mb-10 select-none"
                            draggable={false}
                        />
                        <h1 className="text-5xl font-medium text-textPrimary tracking-tight leading-[1.05] mb-5">
                            Welcome to<br />StreamNook
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-8">
                            Yeah yeah, another setup wizard. A few clicks and we'll get out of your way, promise.
                        </p>
                        {/* webp, not avif: animated AVIF flickers on each loop
                            restart in Android System WebView (the emote blinks
                            in and out). The rest of the emote pipeline is webp
                            already; desktop renders it identically. */}
                        <img
                            src="https://cdn.7tv.app/emote/01F6NMMEER00015NVG2J8ZH77N/4x.webp"
                            alt=""
                            className="h-24 w-auto select-none"
                            draggable={false}
                        />
                    </>
                );

            case 1: {
                if (status.componentsInstalled === true && !status.extractionError) {
                    return (
                        <>
                            <CheckCircle2 size={64} strokeWidth={1.4} className="text-success mb-10" />
                            <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                                Components ready
                            </h1>
                            <p className="text-textSecondary text-base max-w-md">
                                The ad blocker is in place. Moving on.
                            </p>
                        </>
                    );
                }

                return (
                    <>
                        <Loader2 size={56} strokeWidth={1.4} className="text-accent animate-spin mb-10" />
                        <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                            Setting things up
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-8">
                            Installing the ad blocker. This only takes a moment.
                        </p>
                        <div className="flex flex-col gap-2 w-full max-w-xs">
                            <div className="flex items-center gap-3 glass-panel rounded-lg px-4 py-2.5">
                                <Loader2 size={14} className="text-accent animate-spin flex-shrink-0" />
                                <span className="text-sm text-textSecondary">TTV LOL ad blocker</span>
                            </div>
                        </div>
                    </>
                );
            }

            case 3:
                return (
                    <>
                        {status.dropsAuthenticated ? (
                            <CheckCircle2 size={64} strokeWidth={1.4} className="text-success mb-10" />
                        ) : (
                            <Package size={56} strokeWidth={1.4} className="text-accent mb-10" />
                        )}
                        <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                            {status.dropsAuthenticated ? "You're in for Drops" : 'Drops and inventory'}
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-8">
                            {status.dropsAuthenticated
                                ? 'Drops will claim themselves while you watch.'
                                : 'Sign in to track Twitch Drops, watch your inventory, and auto-claim rewards.'}
                        </p>

                        {isAuthenticating && dropsDeviceCode && (
                            <div className="glass-panel rounded-xl p-6 mb-6 w-full max-w-sm">
                                <p className="text-sm text-textSecondary mb-3">Enter this code on Twitch</p>
                                <div className="text-4xl font-mono font-bold text-accent tracking-[0.3em] py-2 tabular-nums">
                                    {dropsDeviceCode.user_code}
                                </div>
                                <div className="pt-3 border-t border-borderSubtle mt-3 flex items-center justify-center gap-2 text-xs text-textMuted">
                                    <Loader2 size={13} className="animate-spin" />
                                    <span>Waiting for authorization</span>
                                </div>
                                <button
                                    onClick={() => openDropsVerificationWindow(dropsDeviceCode.verification_uri)}
                                    className="mt-3 inline-flex items-center justify-center gap-1.5 w-full text-xs text-textSecondary hover:text-textPrimary transition-colors"
                                >
                                    <ExternalLink size={12} />
                                    Reopen sign-in window
                                </button>
                            </div>
                        )}

                        {error && (
                            <div className="flex items-center gap-2 text-error text-sm mb-5 px-3 py-2 rounded-lg bg-error/10">
                                <AlertCircle size={15} />
                                <span>{error}</span>
                            </div>
                        )}

                        {!status.dropsAuthenticated && !isAuthenticating && (
                            <button
                                onClick={handleDropsLogin}
                                className="glass-button flex items-center justify-center gap-2 px-6 py-3 text-textPrimary rounded-xl font-medium"
                            >
                                <Package size={17} />
                                Sign in for Drops
                            </button>
                        )}
                    </>
                );

            case 2:
                return (
                    <>
                        {status.mainAuthenticated ? (
                            <CheckCircle2 size={64} strokeWidth={1.4} className="text-success mb-10" />
                        ) : (
                            <User size={56} strokeWidth={1.4} className="text-accent mb-10" />
                        )}
                        <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                            {status.mainAuthenticated ? "You're signed in" : 'Sign in to Twitch'}
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-8">
                            {status.mainAuthenticated
                                ? 'Your follows, chat, and channel actions are connected.'
                                : 'Connect your account to see your follows, chat, and use channel features.'}
                        </p>

                        {error && (
                            <div className="flex items-center gap-2 text-error text-sm mb-5 px-3 py-2 rounded-lg bg-error/10">
                                <AlertCircle size={15} />
                                <span>{error}</span>
                            </div>
                        )}

                        {!status.mainAuthenticated && (
                            <button
                                onClick={handleMainLogin}
                                disabled={isAuthenticating}
                                className="glass-button flex items-center justify-center gap-2 px-6 py-3 text-textPrimary rounded-xl font-medium disabled:opacity-60"
                            >
                                {isAuthenticating ? (
                                    <>
                                        <Loader2 size={17} className="animate-spin" />
                                        Waiting for sign-in
                                    </>
                                ) : (
                                    <>
                                        <User size={17} />
                                        Sign in with Twitch
                                    </>
                                )}
                            </button>
                        )}
                    </>
                );

            case 4:
                return (
                    <>
                        {whisperImportState.result ? (
                            <CheckCircle2 size={64} strokeWidth={1.4} className="text-success mb-10" />
                        ) : whisperImportState.isImporting ? (
                            <Loader2 size={56} strokeWidth={1.4} className="text-accent animate-spin mb-10" />
                        ) : (
                            <MessageCircle size={56} strokeWidth={1.4} className="text-accent mb-10" />
                        )}
                        <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                            {whisperImportState.result
                                ? 'Whispers imported'
                                : whisperImportState.isImporting
                                    ? 'Importing whispers'
                                    : 'Import your whispers'}
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-8">
                            {whisperImportState.result
                                ? `${whisperImportState.result.conversations.toLocaleString()} conversations, ${whisperImportState.result.messages.toLocaleString()} messages.`
                                : whisperImportState.isImporting
                                    ? 'Running in the background. You can keep going.'
                                    : 'Pull in your private message history so it lives inside the app.'}
                        </p>

                        {whisperImportState.isImporting && whisperImportState.progress && (
                            <div className="glass-panel rounded-xl p-4 mb-6 w-full max-w-sm">
                                <div className="flex items-center gap-3 mb-2">
                                    <Loader2 size={14} className="text-accent animate-spin flex-shrink-0" />
                                    <span className="text-sm text-textPrimary">{whisperImportState.progress.detail}</span>
                                </div>
                                {whisperImportState.exportProgress && whisperImportState.exportProgress.total > 0 && (
                                    <div className="mt-2">
                                        <div className="flex justify-between text-xs text-textMuted mb-1 tabular-nums">
                                            <span>Progress</span>
                                            <span>{whisperImportState.exportProgress.current + 1}/{whisperImportState.exportProgress.total}</span>
                                        </div>
                                        <div className="h-1 bg-borderSubtle rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-accent rounded-full transition-all duration-300"
                                                style={{ width: `${((whisperImportState.exportProgress.current + 1) / whisperImportState.exportProgress.total) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {whisperImportState.error && (
                            <div className="flex items-center gap-2 text-error text-sm mb-5 px-3 py-2 rounded-lg bg-error/10">
                                <AlertCircle size={15} />
                                <span>{whisperImportState.error}</span>
                            </div>
                        )}

                        {!whisperImportState.isImporting && !whisperImportState.result && (
                            <button
                                onClick={async () => {
                                    setWhisperImportStarted(true);
                                    setWhisperImportState({
                                        isImporting: true,
                                        error: null,
                                        result: null,
                                        progress: { step: 0, status: 'running', detail: 'Starting...', current: 0, total: 4 },
                                        estimatedEndTime: null,
                                        totalConversations: 0,
                                        exportProgress: { current: 0, total: 0, username: '' }
                                    });
                                    try {
                                        await invoke('scrape_whispers');
                                    } catch (err) {
                                        Logger.error('[SetupWizard] Whisper import failed:', err);
                                        setWhisperImportState({
                                            isImporting: false,
                                            error: err instanceof Error ? err.message : String(err)
                                        });
                                    }
                                }}
                                className="glass-button flex items-center justify-center gap-2 px-6 py-3 text-textPrimary rounded-xl font-medium"
                            >
                                <Wand2 size={17} />
                                Start import
                            </button>
                        )}
                    </>
                );

            case 5:
                return (
                    <>
                        <Palette size={56} strokeWidth={1.4} className="text-accent mb-8" />
                        <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                            Pick your look
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-8">
                            Choose a theme to start with. Tap one to try it on. There are more options, fonts, and a theme builder in Settings later.
                        </p>
                        <div className="w-full max-w-2xl max-h-[42vh] overflow-y-auto pr-1">
                            <div className="grid grid-cols-3 gap-3">
                                {themes.map((t) => {
                                    const display = t.id === OLED_THEME_ID ? getOledTheme(settings.oled_accent) : t;
                                    return (
                                        <WizardThemeCard
                                            key={t.id}
                                            theme={display}
                                            selected={currentThemeId === t.id}
                                            onSelect={() => handleSelectTheme(t.id)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </>
                );

            case 6:
                return (
                    <>
                        <PanelTop size={56} strokeWidth={1.4} className="text-accent mb-8" />
                        <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                            Set up your sidebar
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-8">
                            This is where your followed channels live. Pick how much of it you want on screen.
                        </p>
                        <div className="grid grid-cols-2 gap-3 w-full max-w-md">
                            {sidebarOptions.map((opt) => {
                                const Icon = opt.icon;
                                const active = sidebarMode === opt.id;
                                return (
                                    <button
                                        key={opt.id}
                                        onClick={() => handleSelectSidebar(opt.id)}
                                        className={`flex flex-col items-start gap-2 px-4 py-3.5 rounded-xl border text-left transition-all duration-200 ${active ? 'border-accent bg-accent/10' : 'border-borderSubtle hover:border-borderLight'}`}
                                    >
                                        <div className="flex items-center gap-2 w-full">
                                            <Icon size={20} className={active ? 'text-accent' : 'text-textSecondary'} />
                                            <span className="text-sm font-semibold text-textPrimary flex-1">{opt.label}</span>
                                            {active && <Check size={16} className="text-accent flex-shrink-0" strokeWidth={3} />}
                                        </div>
                                        <span className="text-xs text-textSecondary">{opt.desc}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                );

            case 7:
                // Mobile gets a real system-notification prompt instead of the
                // desktop's in-app presentation picker. Dynamic Island vs toast is a
                // question about surfaces that only exist inside a desktop window;
                // on a phone the answer is simply the Android notification shade,
                // which works when the app is backgrounded and the others do not.
                if (IS_MOBILE) {
                    return (
                        <>
                            <Bell size={56} strokeWidth={1.4} className="text-accent mb-8" />
                            <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                                Stay in the loop
                            </h1>
                            <p className="text-textSecondary text-base max-w-md mb-8">
                                Get a notification when a followed streamer goes live, a whisper
                                lands, or a drop is claimed. You can fine-tune each type in
                                Settings.
                            </p>
                            <button
                                onClick={handleRequestNativeNotifications}
                                disabled={notifPermission === 'granted'}
                                className={`glass-button w-full max-w-md rounded-xl py-4 text-base font-medium text-textPrimary ${
                                    notifPermission === 'granted' ? 'opacity-60' : ''
                                }`}
                            >
                                {notifPermission === 'granted'
                                    ? 'Notifications enabled'
                                    : 'Enable notifications'}
                            </button>
                            {notifPermission === 'denied' && (
                                <p className="mt-4 max-w-md text-sm text-textMuted">
                                    Notifications are turned off for StreamNook. You can turn them
                                    back on in Android Settings whenever you like.
                                </p>
                            )}
                        </>
                    );
                }
                return (
                    <>
                        <Bell size={56} strokeWidth={1.4} className="text-accent mb-8" />
                        <h1 className="text-4xl font-medium text-textPrimary tracking-tight mb-4">
                            How should we reach you?
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-8">
                            When a followed streamer goes live, a whisper lands, or a drop is claimed. You can fine-tune each type in Settings.
                        </p>
                        <div className="flex flex-col gap-3 w-full max-w-md">
                            {notifOptions.map((opt) => {
                                const Icon = opt.icon;
                                const active = notifMode === opt.id;
                                return (
                                    <button
                                        key={opt.id}
                                        onClick={() => handleSelectNotif(opt.id)}
                                        className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border text-left transition-all duration-200 ${active ? 'border-accent bg-accent/10' : 'border-borderSubtle hover:border-borderLight'}`}
                                    >
                                        <Icon size={22} className={active ? 'text-accent' : 'text-textSecondary'} />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-textPrimary">{opt.label}</div>
                                            <div className="text-xs text-textSecondary">{opt.desc}</div>
                                        </div>
                                        {active && <Check size={18} className="text-accent flex-shrink-0" strokeWidth={3} />}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                );

            case 8: {
                const rows: Array<{ ok: boolean; pending?: boolean; label: string }> = [
                    { ok: status.dropsAuthenticated, label: 'Drops sign-in' },
                    { ok: status.mainAuthenticated, label: 'Twitch sign-in' },
                    {
                        ok: !!whisperImportState.result,
                        pending: whisperImportState.isImporting,
                        label: 'Whisper history'
                    },
                ];

                return (
                    <>
                        <div className="relative mb-10">
                            <img
                                src={streamnookLogo}
                                alt=""
                                className="h-24 w-auto select-none"
                                draggable={false}
                            />
                        </div>
                        <h1 className="text-5xl font-medium text-textPrimary tracking-tight leading-[1.05] mb-5">
                            You're all set
                        </h1>
                        <p className="text-textSecondary text-base max-w-md mb-10">
                            StreamNook is ready. Pick a stream and dive in.
                        </p>
                        <div className="flex flex-col gap-1.5 w-full max-w-sm">
                            {rows.map((row) => (
                                <div
                                    key={row.label}
                                    className="flex items-center justify-between px-4 py-2.5 rounded-lg glass-panel"
                                >
                                    <span className="text-sm text-textSecondary">{row.label}</span>
                                    {row.ok ? (
                                        <Check size={15} className="text-success" />
                                    ) : row.pending ? (
                                        <Loader2 size={15} className="text-accent animate-spin" />
                                    ) : (
                                        <span className="text-xs text-textMuted">skipped</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                );
            }

            default:
                return null;
        }
    };

    if (!isOpen) return null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: STEP_EASE }}
            className="fixed inset-0 z-[60] bg-background overflow-hidden"
        >
            {/* Diffused multi-radial accent wash. Three offset radials at different
                scales blend into each other so there's no single hard transition for
                Mach bands to form on. Combined with the grain layer below this is
                effectively dithered into smoothness. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                    backgroundImage: [
                        'radial-gradient(95% 70% at 50% 18%, rgba(151,177,185,0.075), rgba(151,177,185,0) 78%)',
                        'radial-gradient(65% 50% at 42% 38%, rgba(151,177,185,0.055), rgba(151,177,185,0) 82%)',
                        'radial-gradient(130% 100% at 58% 55%, rgba(151,177,185,0.028), rgba(151,177,185,0) 92%)',
                    ].join(','),
                }}
            />

            {/* Film grain. SVG fractalNoise tiled at 200px and composited with overlay
                so it gently lightens and darkens the canvas in equal measure. Opacity
                tuned low enough that it reads as texture, not visible noise. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-[0.18]"
                style={{
                    backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
                    backgroundRepeat: 'repeat',
                }}
            />

            <div
                data-tauri-drag-region
                className="absolute top-0 left-0 right-0 h-12 z-0"
            />

            <div className="relative h-full w-full flex flex-col">
                {/* Mobile back control. Pinned to the top-left the way onboarding
                    flows normally do, so it never competes with the primary action
                    for the bottom row and the CTA keeps a clean full-width block. */}
                {IS_MOBILE && canGoBack && (
                    <button
                        onClick={() => setCurrentStep(Math.max(0, stepBefore(currentStep)))}
                        aria-label="Back"
                        className="absolute left-2 z-20 flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-textSecondary"
                        style={{ top: 'calc(0.5rem + var(--sn-safe-top))' }}
                    >
                        <ChevronLeft size={18} />
                        Back
                    </button>
                )}
                {/* px-8 py-16 is desktop breathing room. On a 360px-wide phone that
                    padding is a third of the width, and py-16 pushes taller steps
                    (the theme grid) off-screen. Tighten it and let the step scroll. */}
                <div
                    className={`flex-1 flex items-center justify-center min-h-0 ${
                        IS_MOBILE ? 'px-5 py-6 overflow-y-auto' : 'px-8 py-16'
                    }`}
                    style={IS_MOBILE ? { paddingTop: 'calc(1.5rem + var(--sn-safe-top))' } : undefined}
                >
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentStep}
                            initial={{ opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -14 }}
                            transition={{ duration: STEP_DURATION, ease: STEP_EASE }}
                            // Horizontal drag only, so vertical scrolling inside a tall
                            // step (the theme grid) still works. Constraints are pinned
                            // to 0 with a little elasticity: the card rubber-bands to
                            // signal the gesture, then snaps back, and the step change
                            // is driven by the release distance rather than the drag.
                            drag={IS_MOBILE ? 'x' : false}
                            dragConstraints={{ left: 0, right: 0 }}
                            dragElastic={0.15}
                            dragMomentum={false}
                            onDragEnd={(_, info) => {
                                if (!IS_MOBILE) return;
                                // Swallow a second swipe that lands while the previous
                                // step is still animating out, so one flick advances
                                // exactly one step rather than two.
                                const now = performance.now();
                                if (now - lastStepChangeRef.current < STEP_DURATION * 1000) return;
                                // Distance threshold so a slow drag on a theme card is
                                // not read as a page change.
                                const THRESHOLD = 70;
                                if (info.offset.x < -THRESHOLD && canSwipeForward) {
                                    lastStepChangeRef.current = now;
                                    setCurrentStep(stepAfter(currentStep));
                                } else if (info.offset.x > THRESHOLD && canGoBack) {
                                    lastStepChangeRef.current = now;
                                    setCurrentStep(stepBefore(currentStep));
                                }
                            }}
                            className="w-full max-w-2xl flex flex-col items-center text-center"
                        >
                            {renderStepContent()}
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Footer. On desktop this is one row: step dots on the left, Back +
                    primary action on the right. That does not fit a phone. The dots
                    alone run ~160px, and with px-8 padding plus both buttons the row
                    needs ~410px against a 360px viewport, so justify-between pushed
                    the primary button clean off the right edge. Mobile stacks it:
                    centred dots above a full-width action row. */}
                <div
                    className={`relative z-10 ${
                        IS_MOBILE
                            ? 'flex flex-col gap-4 px-5 pt-4 pb-5'
                            : 'flex items-center justify-between px-8 py-6'
                    }`}
                    style={
                        IS_MOBILE
                            ? { paddingBottom: 'calc(1.25rem + var(--sn-safe-bottom))' }
                            : undefined
                    }
                >
                    <div
                        className={`flex items-center gap-2 ${
                            IS_MOBILE ? 'justify-center' : ''
                        }`}
                    >
                        {visibleSteps.map((idx) => {
                            const isActive = idx === currentStep;
                            const isPast = idx < currentStep;
                            return (
                                <button
                                    key={idx}
                                    onClick={() => isPast && setCurrentStep(idx)}
                                    disabled={!isPast}
                                    aria-label={`Step ${idx + 1}`}
                                    aria-current={isActive ? 'step' : undefined}
                                    className={`h-2 rounded-full transition-all duration-300 ${isActive
                                        ? 'w-10 bg-accent shadow-[0_0_14px_rgba(151,177,185,0.55),0_0_4px_rgba(151,177,185,0.8)]'
                                        : isPast
                                            ? 'w-2 bg-accent/50 hover:bg-accent cursor-pointer'
                                            : 'w-2 bg-borderSubtle cursor-default'
                                        }`}
                                />
                            );
                        })}
                    </div>

                    <div className={`flex items-center gap-2 ${IS_MOBILE ? 'w-full' : ''}`}>
                        {/* Back is NOT in this row on mobile. Sharing the row with the
                            primary action made the CTA start wherever Back happened to
                            end, so it had no consistent left margin and read as
                            lopsided. On mobile it lives in the header instead (see the
                            top-left control above), leaving the CTA a clean full-width
                            block. */}
                        {canGoBack && !IS_MOBILE && (
                            <button
                                onClick={() => setCurrentStep(Math.max(0, stepBefore(currentStep)))}
                                className="flex items-center gap-1 px-3 py-2 text-sm text-textSecondary hover:text-textPrimary transition-colors rounded-lg"
                            >
                                <ChevronLeft size={15} />
                                Back
                            </button>
                        )}
                        {primaryAction && (!IS_MOBILE || showPrimaryOnMobile) && (
                            <button
                                onClick={primaryAction.onClick}
                                disabled={primaryAction.disabled}
                                className={`glass-button text-textPrimary rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                                    IS_MOBILE ? 'w-full py-4 text-base' : 'px-5 py-2.5 text-sm'
                                }`}
                            >
                                {primaryAction.label}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default SetupWizard;
