// What's New, for the Android build.
//
// The desktop panel lists GitHub releases from winters27/StreamNook, which are
// DESKTOP releases: their notes describe desktop fixes, and their version
// numbers are the 8.x line the phone does not follow. Showing them here told a
// phone user about changes that never shipped to them.
//
// The mobile changelog is the `notes` field of the Android update manifest,
// which is written next to the APK it describes. That makes the changelog and
// the build it belongs to physically impossible to get out of step.
//
// Limitation worth knowing: the manifest only ever describes the CURRENT
// release, so this shows one entry rather than a history. A real archive would
// need a separate object in R2 that accumulates past releases; that is worth
// doing once there are enough Android releases for a history to mean anything.
import React, { useEffect, useState } from 'react';
import { Sparkle } from 'phosphor-react';
import { getAppVersion } from '../updateCheck';
import { Logger } from '../../utils/logger';

const MANIFEST_URL = 'https://streamnook.app/api/v1/update-android';

interface Release {
  version: string;
  notes?: string;
  published_at?: string;
}

export const MobileWhatsNew: React.FC = () => {
  const [release, setRelease] = useState<Release | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [ver, res] = await Promise.all([
          getAppVersion(),
          fetch(MANIFEST_URL, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        setRunning(ver);
        // 503 is the documented "nothing published yet" state.
        if (!res.ok) {
          setState('unavailable');
          return;
        }
        setRelease((await res.json()) as Release);
        setState('ready');
      } catch (err) {
        Logger.warn('[WhatsNew] could not load the Android release notes:', err);
        if (!cancelled) setState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return <div className="py-10 text-center text-sm text-textMuted">Loading…</div>;
  }

  if (state === 'unavailable' || !release) {
    return (
      <div className="py-10 text-center text-sm text-textMuted">
        Release notes are not available right now.
        {running && <div className="mt-1 text-[12.5px]">You are on {running}</div>}
      </div>
    );
  }

  const date = release.published_at
    ? new Date(release.published_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  // The published version is not necessarily the one running: someone can be a
  // release behind. Saying so is more useful than implying they match.
  const isRunning = running === release.version;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <Sparkle size={20} weight="fill" className="text-accent shrink-0" />
        <div className="min-w-0">
          <div className="text-[17px] font-bold text-textPrimary">{release.version}</div>
          <div className="text-[12.5px] text-textMuted">
            {date}
            {date && !isRunning ? ' · ' : ''}
            {!isRunning && running ? `you are on ${running}` : ''}
          </div>
        </div>
      </div>

      {release.notes ? (
        // Plain text with real line breaks, the way the manifest writes it.
        // Nothing here needs a markdown renderer, and pulling one in for a
        // handful of paragraphs would be the wrong trade.
        <div className="whitespace-pre-line text-[14.5px] leading-relaxed text-textSecondary">
          {release.notes}
        </div>
      ) : (
        <div className="text-[14.5px] text-textMuted">No notes for this release.</div>
      )}
    </div>
  );
};

export default MobileWhatsNew;
