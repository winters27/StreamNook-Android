// Twitch moderator actions, Helix-backed.
//
// The same two invokes the desktop message row uses. They live here because on
// mobile the actions hang off a long-press sheet rather than a hover menu, and
// because mod status has to be checked per channel once several rooms are open.
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '../../utils/logger';

/** Mod powers are read off your own badges in that channel, same rule as desktop. */
export function isModeratorFrom(userBadges: string | null | undefined): boolean {
  if (!userBadges) return false;
  return userBadges.includes('moderator') || userBadges.includes('broadcaster');
}

export async function deleteMessage(broadcasterId: string, messageId: string): Promise<boolean> {
  try {
    await invoke('delete_chat_message', { broadcasterId, messageId });
    return true;
  } catch (err) {
    Logger.error('[MobileMod] delete failed:', err);
    return false;
  }
}

/** `durationSeconds: null` is a permanent ban. */
export async function banUser(
  broadcasterId: string,
  targetUserId: string,
  durationSeconds: number | null,
): Promise<boolean> {
  try {
    await invoke('ban_user', {
      broadcasterId,
      targetUserId,
      duration: durationSeconds,
      reason: null,
    });
    return true;
  } catch (err) {
    Logger.error('[MobileMod] ban/timeout failed:', err);
    return false;
  }
}

export const TIMEOUT_OPTIONS: { label: string; seconds: number }[] = [
  { label: '60s', seconds: 60 },
  { label: '10m', seconds: 600 },
  { label: '1h', seconds: 3600 },
  { label: '24h', seconds: 86400 },
];
