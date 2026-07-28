// Platform capability map. For SHARED services/stores that both shells import.
// Tree-level desktop-vs-mobile selection happens once in main.tsx (lazy route
// split); components inside either tree should NOT consult this map, because
// they only ever run on their own platform.
import { IS_MOBILE } from './utils/platform';

export const features = Object.freeze({
  /** Popout windows, tray, window sizing/fullscreen orchestration. */
  multiWindow: !IS_MOBILE,
  /** convertFileSrc + download_and_cache_file local asset cache. Mobile forces
   *  the CDN-URL fallback until the Android asset protocol/cache dir is wired. */
  assetDiskCache: !IS_MOBILE,
  /** Per-row backdrop-filter atmosphere frost in chat (GPU-heavy on phones). */
  richAtmospheres: !IS_MOBILE,
  discordRpc: !IS_MOBILE,
  plugins: !IS_MOBILE,
  modTools: !IS_MOBILE,
});
