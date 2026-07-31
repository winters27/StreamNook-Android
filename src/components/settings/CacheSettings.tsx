import { useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
// Shared panel: both shells render it, so a platform branch here is legitimate.
import { IS_MOBILE } from '../../utils/platform';
import { SettingsSection, SettingsRow } from './_primitives';
import EmotePrefetchSection from './EmotePrefetchSection';

import { Logger } from '../../utils/logger';
const CacheSettings = () => {
  const { settings, updateSettings } = useAppStore();
  /** What the cache currently holds, shown under the buttons. Null until asked. */
  const [cacheInfo, setCacheInfo] = useState<string | null>(null);

  const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-accent' : 'bg-gray-600'
        }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
      />
    </button>
  );

  return (
    <div className="space-y-8">
      <SettingsSection label="Cache">
        <SettingsRow
          title="Enable Cache"
          description="Cache emotes and badges to speed up loading"
          control={
            <Toggle
              enabled={settings.cache?.enabled ?? true}
              onChange={() =>
                updateSettings({
                  ...settings,
                  cache: { ...settings.cache, enabled: !(settings.cache?.enabled ?? true) },
                })
              }
            />
          }
        />

        <SettingsRow
          title={`Cache Expiry: ${settings.cache?.expiry_days ?? 7} days`}
          description="How long to keep cached data before refreshing"
        >
          <input
            type="range"
            min="1"
            max="30"
            step="1"
            value={settings.cache?.expiry_days ?? 7}
            onChange={(e) =>
              updateSettings({
                ...settings,
                cache: { ...settings.cache, expiry_days: parseInt(e.target.value) },
              })
            }
            className="w-full accent-accent cursor-pointer"
          />
        </SettingsRow>

        <SettingsRow
          title="Cache Maintenance"
          description="View cache statistics or delete all cached emotes and badges"
        >
          <div className="flex gap-2">
            <button
              onClick={async () => {
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  // The real cache (emotes/badges/cosmetics + the AFK prefetch) lives
                  // in the UNIVERSAL cache. The legacy get_cache_statistics only counts
                  // loose files in the cache root and misses cache/universal entirely.
                  const stats = (await invoke('get_universal_cache_statistics')) as {
                    total_entries: number;
                    entries_by_type: Record<string, number>;
                    cache_dir: string;
                  };
                  const parts = Object.entries(stats.entries_by_type || {})
                    .filter(([, n]) => n > 0)
                    .map(([t, n]) => `${n} ${t}`);
                  Logger.debug('[Cache] Universal cache dir:', stats.cache_dir);
                  // Rendered INLINE rather than as a toast. The result used to go
                  // out as an 'info' toast, and ToastManager drops everything on
                  // mobile that is not an error or carrying an action - so the
                  // button ran, succeeded, and appeared to do nothing at all.
                  // Inline is also just better: a count you want to watch climb
                  // should stay on screen, not fade after three seconds.
                  setCacheInfo(parts.length ? parts.join(', ') : 'empty');
                } catch (error) {
                  Logger.error('Failed to get cache stats:', error);
                  setCacheInfo(null);
                  // Errors DO survive the mobile toast filter.
                  useAppStore.getState().addToast('Failed to get cache statistics: ' + error, 'error');
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-all"
            >
              View Cache Info
            </button>
            {/* Desktop only: this hands the path to the OS file manager. The
                cache lives in app-private storage on Android, where there is
                nothing for the user to open it with. */}
            {!IS_MOBILE && (
              <button
                onClick={async () => {
                  try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    await invoke('open_universal_cache_folder');
                  } catch (error) {
                    Logger.error('Failed to open cache folder:', error);
                    useAppStore.getState().addToast('Failed to open cache folder: ' + error, 'error');
                  }
                }}
                className="px-4 py-2 bg-secondary hover:bg-surface-hover text-textPrimary text-sm font-medium rounded transition-all"
              >
                Open Folder
              </button>
            )}
            <button
              onClick={async () => {
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  await invoke('clear_cache'); // legacy cache root
                  await invoke('clear_all_universal_cache'); // emotes/badges/cosmetics + prefetch

                  // Wiping the disk is only half of it. Both services keep an
                  // in-memory Map of id -> local file path, and those entries
                  // outlive the files: `getCachedEmoteUrl` keeps handing back
                  // convertFileSrc(<deleted path>), so emotes and badges render
                  // BROKEN until the app restarts. Rust already learned this
                  // lesson - `clear_universal_cache` drops its manifest mirror
                  // for exactly this reason, with a comment saying so - but the
                  // frontend half was never wired up: both of these existed with
                  // ZERO callers.
                  //
                  // This was dormant while `assetDiskCache` was off for mobile,
                  // because the maps were never populated there. Turning the
                  // cache on made it reachable.
                  const [{ clearEmoteCache }, { clearBadgeImageCache }] = await Promise.all([
                    import('../../services/emoteService'),
                    import('../../services/badgeImageCacheService'),
                  ]);
                  await clearEmoteCache();
                  await clearBadgeImageCache();

                  // The panel is showing a count that is now wrong, so say so
                  // rather than leaving a stale number sitting there.
                  setCacheInfo('empty');
                  const { addToast } = useAppStore.getState();
                  addToast('Cache cleared successfully!', 'success');
                } catch (error) {
                  Logger.error('Failed to clear cache:', error);
                  const { addToast } = useAppStore.getState();
                  addToast('Failed to clear cache: ' + error, 'error');
                }
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-all"
            >
              Clear Cache
            </button>
          </div>
          {cacheInfo && (
            <div className="mt-2 text-[13px] text-textSecondary">
              Currently cached: <span className="text-textPrimary">{cacheInfo}</span>
            </div>
          )}
        </SettingsRow>
      </SettingsSection>

      <EmotePrefetchSection />
    </div>
  );
};

export default CacheSettings;
