// Native system notifications for the mobile shell.
//
// The plugin's JS wrapper is unusable here: `sendNotification` calls
// `new window.Notification(...)`, and Android System WebView has no Web
// Notifications API, so it throws. The Rust commands are invoked directly
// instead (the ACL exposes allow-notify / allow-request-permission /
// allow-is-permission-granted).
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '../utils/logger';

export async function isNotificationPermissionGranted(): Promise<boolean> {
  try {
    return await invoke<boolean>('plugin:notification|is_permission_granted');
  } catch (err) {
    Logger.warn('[Notifications] permission probe failed:', err);
    return false;
  }
}

/** Returns true when permission is granted (asking only if not already). */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (await isNotificationPermissionGranted()) return true;
  try {
    const result = await invoke<string>('plugin:notification|request_permission');
    return result === 'granted';
  } catch (err) {
    // Surface it: mapping every failure to "denied" makes a broken plugin
    // registration indistinguishable from the user declining.
    Logger.error('[Notifications] permission request failed:', err);
    return false;
  }
}

export interface SystemNotification {
  title: string;
  body?: string;
  /** Large icon / thumbnail, e.g. the streamer's avatar. */
  largeBody?: string;
  icon?: string;
}

export async function postSystemNotification(n: SystemNotification): Promise<void> {
  try {
    await invoke('plugin:notification|notify', {
      options: {
        title: n.title,
        body: n.body,
        largeBody: n.largeBody,
        icon: n.icon,
      },
    });
  } catch (err) {
    Logger.warn('[Notifications] notify failed:', err);
  }
}
