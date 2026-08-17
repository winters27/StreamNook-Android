import type { Window } from '@tauri-apps/api/window';
import { Logger } from './logger';

/**
 * Read the window's inner size in LOGICAL (CSS) pixels.
 *
 * Tauri's `innerSize()` returns PHYSICAL device pixels. Every offset in the
 * aspect-ratio formula (40px title bar, chat size, measured sidebar width,
 * MultiNook gaps) is a CSS pixel, so the window size has to be converted before it
 * can be mixed with them. Writing a physical number back as a `LogicalSize`
 * multiplies the window by the scale factor on every resize event, which is what
 * made the window grow off-screen on any display above 100% scaling.
 */
export const getLogicalInnerSize = async (
  win: Window,
): Promise<{ width: number; height: number; scale: number }> => {
  const scale = await win.scaleFactor();
  const size = await win.innerSize();
  return {
    width: Math.round(size.width / scale),
    height: Math.round(size.height / scale),
    scale,
  };
};

/**
 * Keep an automatic resize inside the current monitor's work area, preserving the
 * requested shape. Only the aspect-lock resizes go through this; a user dragging the
 * window edge is never clamped.
 */
export const clampToWorkArea = async (
  width: number,
  height: number,
): Promise<{ width: number; height: number }> => {
  const MIN_WIDTH = 800;
  const MIN_HEIGHT = 600;
  try {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const monitor = await currentMonitor();
    if (!monitor) return { width, height };

    const maxWidth = Math.floor(monitor.workArea.size.width / monitor.scaleFactor);
    const maxHeight = Math.floor(monitor.workArea.size.height / monitor.scaleFactor);

    const factor = Math.min(1, maxWidth / width, maxHeight / height);
    if (factor >= 1) return { width, height };

    return {
      width: Math.max(MIN_WIDTH, Math.round(width * factor)),
      height: Math.max(MIN_HEIGHT, Math.round(height * factor)),
    };
  } catch (error) {
    Logger.error('[WindowSizing] Failed to clamp to work area:', error);
    return { width, height };
  }
};
