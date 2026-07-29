// Standalone hls.js engine for the mobile player. Deliberately NOT extracted
// from VideoPlayer.tsx: the desktop createPlayer interleaves Plyr construction,
// LL start-position logic, and window orchestration that took months to settle;
// this is the lean subset a phone needs. Config values mirror the tuned desktop
// block. LL parts mode is off for v1 (standard-latency playback; the loopback
// stream server serves both paths fine).
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { setActiveVideo } from '../../utils/activeVideo';
import { Logger } from '../../utils/logger';

// The Rust watch heartbeat only emits minute-watched events (drops progress +
// channel points) while the player reports it is actually playing. The desktop
// VideoPlayer does this; without the mobile player doing the same, watching on
// the phone earned nothing.
function reportPlaying(playing: boolean): void {
  invoke('report_player_playing', { playing }).catch(() => {});
}

export type MobilePlayerState = 'idle' | 'loading' | 'playing' | 'stalled' | 'error';

export function useMobileHlsEngine(videoRef: React.RefObject<HTMLVideoElement>) {
  const streamUrl = useAppStore((s) => s.streamUrl);
  const [state, setState] = useState<MobilePlayerState>('idle');
  const hlsRef = useRef<Hls | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    const seq = ++seqRef.current;

    // Teardown of any prior instance whenever the url changes or we unmount.
    const destroy = () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* already dead */
        }
        hlsRef.current = null;
      }
    };

    if (!video || !streamUrl || streamUrl === 'offline') {
      destroy();
      setState(streamUrl === 'offline' ? 'error' : 'idle');
      return;
    }

    if (!Hls.isSupported()) {
      // Android System WebView always has MSE; this is a diagnostics guard.
      Logger.error('[MobilePlayer] hls.js unsupported in this webview');
      setState('error');
      return;
    }

    setState('loading');
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      startFragPrefetch: false,
      backBufferLength: 30,
      maxBufferLength: 30,
      maxMaxBufferLength: 120,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.2,
      nudgeMaxRetry: 3,
      maxFragLookUpTolerance: 0.5,
      liveSyncDuration: 4,
      liveMaxLatencyDuration: 60,
      maxLiveSyncPlaybackRate: 1,
      liveDurationInfinity: true,
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 3,
      manifestLoadingRetryDelay: 1000,
      levelLoadingTimeOut: 10000,
      levelLoadingMaxRetry: 4,
      levelLoadingRetryDelay: 1000,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 1000,
      startLevel: -1,
      abrEwmaDefaultEstimate: 1_500_000,
      abrEwmaFastLive: 3.0,
      abrEwmaSlowLive: 9.0,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,
    });
    hlsRef.current = hls;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (seq !== seqRef.current) return;
      video.play().catch((err) => {
        Logger.warn('[MobilePlayer] autoplay rejected:', err);
      });
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (seq !== seqRef.current) return;
      if (!data.fatal) return;
      Logger.warn('[MobilePlayer] fatal hls error:', data.type, data.details);
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          setState('stalled');
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          setState('stalled');
          hls.recoverMediaError();
          break;
        default:
          setState('error');
          destroy();
      }
    });

    const onPlaying = () => {
      if (seq !== seqRef.current) return;
      setState('playing');
      reportPlaying(true);
    };
    const onWaiting = () => {
      if (seq !== seqRef.current) return;
      setState('stalled');
      reportPlaying(false);
    };
    const onPauseOrEnd = () => {
      if (seq !== seqRef.current) return;
      reportPlaying(false);
    };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('pause', onPauseOrEnd);
    video.addEventListener('ended', onPauseOrEnd);

    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    // Register as the active video so app-wide integrations (volume, stats,
    // watch heartbeat consumers) see this element like the desktop player's.
    setActiveVideo(video);

    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('pause', onPauseOrEnd);
      video.removeEventListener('ended', onPauseOrEnd);
      reportPlaying(false);
      if (seq === seqRef.current) setActiveVideo(null);
      destroy();
    };
    // videoRef identity is stable (a ref); streamUrl drives the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl]);

  return { state };
}
