// Touch-first player surface: the video element plus a tap-driven glass control
// overlay. No Plyr; hls.js runs via useMobileHlsEngine.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsOut, Columns, Eye, Gear, Pause, PictureInPicture, Play, Rows, ShareNetwork, SpeakerHigh, SpeakerSlash } from 'phosphor-react';
import { shareText } from '../nativeBridge';
import { buildShareUrl } from '../../utils/shareLink';
import { useAppStore } from '../../stores/AppStore';
import { useMobileHlsEngine } from './useMobileHlsEngine';
import { QualitySheet } from './QualitySheet';
import PenroseMarch from '../../components/PenroseMarch';

const CONTROLS_HIDE_MS = 3000;

// "2h 14m" since the broadcast started, refreshed while the overlay is up.
function formatUptime(startedAt: string | undefined, nowMs: number): string {
  if (!startedAt) return '';
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return '';
  const totalSec = Math.max(0, Math.floor((nowMs - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const MobilePlayer: React.FC<{
  /** Landscape immersive mode: overlay carries no bottom rounding, adds insets. */
  immersive?: boolean;
  onToggleFullscreen?: () => void;
  /** Hands playback to the OS picture-in-picture window. */
  onEnterPip?: () => void;
  /** Mini/PiP presentation: video only, no overlay chrome. */
  compact?: boolean;
  /** Current big-screen arrangement, for the toggle's icon and label. */
  layoutMode?: 'columns' | 'stacked';
  /** Set only where both arrangements fit, which is what gates the control. */
  onToggleLayout?: () => void;
}> = ({
  immersive = false,
  onToggleFullscreen,
  onEnterPip,
  compact = false,
  layoutMode,
  onToggleLayout,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { state } = useMobileHlsEngine(videoRef);
  const restartStream = useAppStore((s) => s.restartStream);
  const currentStream = useAppStore((s) => s.currentStream);

  const [controlsVisible, setControlsVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Uptime ticks while the overlay chrome exists at all.
  useEffect(() => {
    if (compact) return;
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [compact]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  const onSurfaceTap = () => {
    setControlsVisible((v) => {
      const next = !v;
      if (next) scheduleHide();
      return next;
    });
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPaused(false);
    } else {
      video.pause();
      setPaused(true);
    }
    scheduleHide();
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    scheduleHide();
  };

  return (
    <div
      className="relative w-full h-full bg-black overflow-hidden"
      onClick={onSurfaceTap}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        autoPlay
        // A <video> with no poster gets Android WebView's own grey play-triangle
        // placeholder until the first frame decodes. A 1x1 transparent poster
        // suppresses it, so what shows before playback is our logo below.
        poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
      />

      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <PenroseMarch size={compact ? 44 : 84} />
        </div>
      )}

      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
          <div className="text-sm text-white/80">Stream unavailable</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void restartStream();
            }}
            className="glass-button px-5 py-2.5 text-sm font-semibold text-white"
          >
            Retry
          </button>
        </div>
      )}

      {/* Control overlay. Carries the persistent stream info (channel, title,
          category, viewers, uptime) so nothing has to sit between the player
          and chat, matching how the Twitch app does it. */}
      <div
        className={`absolute inset-0 transition-opacity duration-200 ${
          controlsVisible && !compact ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.28) 26%, transparent 46%, transparent 62%, rgba(0,0,0,0.6) 100%)',
        }}
      >
        {/* Stream info, top-left */}
        {currentStream && (
          <div
            className="absolute inset-x-0 top-0 px-3 pt-2"
            style={immersive ? { paddingTop: 'calc(var(--sn-safe-t, 0px) + 8px)' } : undefined}
          >
            {/* Identity row: avatar + name, with the live metrics opposite. */}
            <div className="flex items-center gap-2 min-w-0">
              {currentStream.profile_image_url ? (
                <img
                  src={currentStream.profile_image_url}
                  alt=""
                  draggable={false}
                  className="w-7 h-7 rounded-full object-cover shrink-0 ring-2 ring-live/80"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-white/15 shrink-0 flex items-center justify-center text-[12px] font-bold text-white ring-2 ring-live/80">
                  {currentStream.user_name?.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-[13.5px] font-semibold text-white truncate">
                {currentStream.user_name}
              </span>
              {currentStream.broadcaster_type === 'partner' && (
                <svg className="w-3 h-3 shrink-0 -ml-0.5" viewBox="0 0 16 16" fill="#9146FF">
                  <path
                    fillRule="evenodd"
                    d="M12.5 3.5 8 2 3.5 3.5 2 8l1.5 4.5L8 14l4.5-1.5L14 8l-1.5-4.5ZM7 11l4.5-4.5L10 5 7 8 5.5 6.5 4 8l3 3Z"
                    clipRule="evenodd"
                  ></path>
                </svg>
              )}
              <span className="ml-auto flex items-center gap-2 shrink-0 pl-2">
                <span className="flex items-center gap-1 text-[12px] font-medium text-live">
                  <Eye size={12} weight="fill" />
                  {currentStream.viewer_count.toLocaleString()}
                </span>
                <span className="text-[12px] text-white/70">
                  {formatUptime(currentStream.started_at, nowMs)}
                </span>
              </span>
            </div>
            {/* Title + category run the full width beneath the identity row. */}
            <div className="text-[12.5px] text-white/85 truncate leading-snug mt-1">
              {currentStream.title}
            </div>
            {currentStream.game_name && (
              <div className="text-[11.5px] text-white/60 truncate leading-snug">
                {currentStream.game_name}
              </div>
            )}
          </div>
        )}
        {/* Center play/pause */}
        <button
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-black/45 flex items-center justify-center text-white active:scale-95 transition-transform"
          aria-label={paused ? 'Play' : 'Pause'}
        >
          {paused ? <Play size={30} weight="fill" /> : <Pause size={30} weight="fill" />}
        </button>

        {/* Bottom bar */}
        <div
          className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 pb-2"
          style={immersive ? { paddingBottom: 'calc(var(--sn-safe-b, 0px) + 8px)' } : undefined}
        >
          <div className="flex items-center gap-1 min-w-0">
            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-live/90 text-white leading-none">
              LIVE
            </span>
          </div>
          <div className="flex items-center">
            <button
              onClick={toggleMute}
              className="sn-touch flex items-center justify-center text-white"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <SpeakerSlash size={21} /> : <SpeakerHigh size={21} />}
            </button>
            {currentStream && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Our own share link, not a raw twitch.tv URL: the landing
                  // page hands off to StreamNook when it is installed and
                  // falls back to Twitch when it is not. buildShareUrl also
                  // carries the day tag that keeps Discord from serving a
                  // stale preview card. Same helper the desktop share uses.
                  shareText(
                    `${currentStream.user_name} is live: ${buildShareUrl(currentStream.user_login)}`,
                    currentStream.title || currentStream.user_name,
                  );
                }}
                className="sn-touch flex items-center justify-center text-white"
                aria-label="Share stream"
              >
                <ShareNetwork size={21} />
              </button>
            )}
            {onEnterPip && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEnterPip();
                }}
                className="sn-touch flex items-center justify-center text-white"
                aria-label="Picture in picture"
              >
                <PictureInPicture size={21} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setQualityOpen(true);
              }}
              className="sn-touch flex items-center justify-center text-white"
              aria-label="Quality"
            >
              <Gear size={21} />
            </button>
            {/* Only on a screen where both arrangements genuinely work, so this
                never appears as a control with one sensible setting. */}
            {onToggleLayout && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLayout();
                }}
                className="sn-touch flex items-center justify-center text-white"
                aria-label={
                  layoutMode === 'columns' ? 'Stack player above chat' : 'Put chat beside player'
                }
              >
                {layoutMode === 'columns' ? <Rows size={21} /> : <Columns size={21} />}
              </button>
            )}
            {onToggleFullscreen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFullscreen();
                }}
                className="sn-touch flex items-center justify-center text-white"
                aria-label="Fullscreen"
              >
                <ArrowsOut size={21} />
              </button>
            )}
          </div>
        </div>
      </div>

      <QualitySheet open={qualityOpen} onClose={() => setQualityOpen(false)} />
    </div>
  );
};
