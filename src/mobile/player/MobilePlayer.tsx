// Touch-first player surface: the video element plus a tap-driven glass control
// overlay. No Plyr; hls.js runs via useMobileHlsEngine.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsOut, Gear, Pause, PictureInPicture, Play, SpeakerHigh, SpeakerSlash } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { useMobileHlsEngine } from './useMobileHlsEngine';
import { QualitySheet } from './QualitySheet';

const CONTROLS_HIDE_MS = 3000;

export const MobilePlayer: React.FC<{
  /** Landscape immersive mode: overlay carries no bottom rounding, adds insets. */
  immersive?: boolean;
  onToggleFullscreen?: () => void;
  /** Hands playback to the OS picture-in-picture window. */
  onEnterPip?: () => void;
}> = ({ immersive = false, onToggleFullscreen, onEnterPip }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { state } = useMobileHlsEngine(videoRef);
  const restartStream = useAppStore((s) => s.restartStream);
  const currentStream = useAppStore((s) => s.currentStream);

  const [controlsVisible, setControlsVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      />

      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
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

      {/* Control overlay */}
      <div
        className={`absolute inset-0 transition-opacity duration-200 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 30%, transparent 65%, rgba(0,0,0,0.55) 100%)',
        }}
      >
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
            {currentStream && (
              <span className="ml-1.5 text-[13px] text-white/90 font-medium truncate max-w-[45vw]">
                {currentStream.user_name}
              </span>
            )}
          </div>
          <div className="flex items-center">
            <button
              onClick={toggleMute}
              className="sn-touch flex items-center justify-center text-white"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <SpeakerSlash size={21} /> : <SpeakerHigh size={21} />}
            </button>
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
