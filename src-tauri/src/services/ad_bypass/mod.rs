//! Ad-free live playback for Android.
//!
//! # Why this exists
//!
//! Ad handling shipped inside the core relay through v7.8.6. `99bd2e1` took it
//! out: the core became ad-neutral and resolution became a plugin hook
//! (`playback.resolve`). On desktop that works. On Android it can't: a plugin
//! is a spawned native child process talking stdio JSON-RPC, and the platform's
//! W^X sandbox forbids executing an installed binary, so the hook can never be
//! filled and the phone has had no ad path at all.
//!
//! This module brings 7.8.6's proven behavior forward for Android only. Desktop
//! keeps its ad-neutral core and its plugin model, unchanged: the whole module
//! is compiled for Android only, and the relay reaches it through gated lines
//! that do not exist in a desktop build.
//!
//! # Shape
//!
//! - `proxies`: the bundled relay pool and the user's override.
//! - `master`: race the pool, validate the answer, splice the above-1080p
//!   tiers back in from the viewer's own authenticated master.
//! - `filter`: strip ad segments out of every served media playlist.
//! - `pivot`: when a whole window is ads, re-resolve through another region.
//!
//! # The two seams it occupies
//!
//! Resolve happens once per stream, in `commands::streaming`, in the same place
//! a resolution-owning plugin would be asked. Serving happens on every playlist
//! poll, in `stream_server`, strictly before `hls_projection::stabilize` (which
//! records segment URLs, so feeding it ad segments would poison it).
//!
//! # Low latency
//!
//! The LL-HLS origin synthesizes its own playlist and serves it before the
//! relay's filter seam is ever reached, and it activates on CMAF (HEVC/AV1)
//! regardless of the experimental setting. The two cannot both own the
//! playlist, so `LlOrigin::start` returns inactive while `active()` is true.

// Android builds only. `test` rides along so the stripper's unit tests can run
// on a host toolchain; that is a test-only compile, never part of a desktop app.
#![cfg(any(target_os = "android", test))]

pub mod filter;
pub mod master;
pub mod pivot;
pub mod proxies;

use log::{debug, info};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::models::settings::VideoPlayerSettings;
use crate::services::twitch_auth_service::TwitchAuthService;
use crate::services::twitch_resolver::{self as tr, ResolvedLive};

pub use filter::FilterOutcome;

/// The user's setting, mirrored where the relay can read it. The relay's
/// playlist handler runs far from any Tauri `State`, so the authoritative value
/// is copied here on every live resolve (which is also the only moment it can
/// change what happens to a stream).
static ENABLED: AtomicBool = AtomicBool::new(true);

/// True while the stream now playing was resolved through a relay. Distinct
/// from `ENABLED`: an entitled viewer (Turbo or a channel sub) is already
/// ad-free through Twitch itself and never routes through a relay, and a stream
/// whose relays all failed fell back to the direct master.
static ACTIVE: AtomicBool = AtomicBool::new(false);

/// Whether ad-free playback is switched on.
pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Whether the stream now playing is being served through a relay. This is what
/// makes ad-free playback and the LL-HLS origin mutually exclusive.
///
/// Only live starts touch it, so a VOD or clip opened after a relayed live
/// stream reads the stale `true`. That is harmless: a VOD carries no
/// `#EXT-X-TWITCH-PREFETCH` hints, so the origin declines it either way.
pub fn active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

/// Resolve a live channel through a relay, ad-free.
///
/// Mirrors the `playback.resolve` plugin contract exactly, because it sits in
/// the same seam: `core` is the core resolver's own result, and returning
/// `None` means "the core resolution serves". It declines in four cases: the
/// feature is off, the viewer is entitled (already ad-free, and routing them
/// through a relay would cost them their above-1080p tiers), every relay
/// failed, or the relay's master turned out to be unusable. An ad-bearing
/// stream beats no stream, which is 7.8.6's rule and Streamlink's before it.
pub async fn resolve_master(
    channel: &str,
    quality: &str,
    core: Option<&ResolvedLive>,
    settings: &VideoPlayerSettings,
    auth: TwitchAuthService,
) -> Option<ResolvedLive> {
    ENABLED.store(settings.ad_bypass_enabled, Ordering::Relaxed);
    if !settings.ad_bypass_enabled {
        stand_down();
        return None;
    }
    if core.map(|r| r.status.entitled).unwrap_or(false) {
        debug!("[AdBypass] {} is entitled; no relay needed", channel);
        stand_down();
        return None;
    }

    let configured = configured_bases(settings);
    let resolved = resolve_through_relay(channel, quality, core, &configured).await;
    let Some((resolved, base)) = resolved else {
        stand_down();
        return None;
    };

    info!(
        "[AdBypass] {} resolved ad-free through {} (region={:?})",
        channel, base, resolved.status.proxy_region
    );
    ACTIVE.store(true, Ordering::Relaxed);
    pivot::arm(
        channel.to_string(),
        quality.to_string(),
        configured,
        base,
        auth,
    );
    Some(resolved)
}

/// The relay bases to prefer, in order: the user's override when they set one,
/// otherwise the bundled pool.
fn configured_bases(settings: &VideoPlayerSettings) -> Vec<String> {
    let custom = proxies::parse_bases(&settings.ad_bypass_proxies);
    if custom.is_empty() {
        proxies::bundled()
    } else {
        custom
    }
}

/// Race `preferred` (falling back to the rest of the bundled pool), graft the
/// viewer's above-1080p tiers onto the winner, and select the requested
/// quality. Returns the resolution and the winning base. Shared by the initial
/// resolve and the pivot's re-resolve.
pub(crate) async fn resolve_through_relay(
    channel: &str,
    quality: &str,
    core: Option<&ResolvedLive>,
    preferred: &[String],
) -> Option<(ResolvedLive, String)> {
    let (base, relay_master) = match master::fetch_with_fallback(channel, preferred).await {
        Ok(win) => win,
        Err(e) => {
            debug!("[AdBypass] {} no relay answered ({})", channel, e);
            return None;
        }
    };

    // The core result already holds the viewer's authenticated master, so the
    // splice costs nothing extra. Logged out (or a failed core resolve) simply
    // means there are no above-1080p tiers to graft.
    let full_master = match core {
        Some(c) => master::splice(&relay_master, &c.master),
        None => relay_master,
    };
    let region = proxies::region_for_base(&base);

    match tr::resolve_from_master(channel, full_master, quality, Some(base.clone()), region) {
        Ok(mut resolved) => {
            // `resolve_from_master` stamps the plugin provenance; this is the
            // in-core Android path, so say so for the UI's playback badge.
            resolved.status.mode = "proxy".to_string();
            Some((resolved, base))
        }
        Err(e) => {
            debug!("[AdBypass] {} relay master unusable ({})", channel, e);
            None
        }
    }
}

/// Give the stream back to the normal path: no relay in use, no pivot armed.
fn stand_down() {
    ACTIVE.store(false, Ordering::Relaxed);
    pivot::disarm();
}

/// Strip leaked ad segments out of a served media playlist, and escalate to a
/// different relay region when stripping leaves nothing playable.
///
/// Returns the playlist to serve: the original text byte-for-byte whenever the
/// feature is off or nothing was dropped, so an ad-free poll is untouched.
/// Filtering runs whether or not a relay is in use, because a leaked ad on an
/// entitled stream is worth removing too. The escalation only fires for a relayed
/// stream, since that is the only one with somewhere else to go.
pub fn filter_and_escalate(playlist: &str) -> String {
    if !enabled() {
        return playlist.to_string();
    }
    let (filtered, outcome) = filter::filter_ad_segments(playlist);
    pivot::maybe_trigger(outcome.all_ads());
    if outcome.dropped == 0 {
        return playlist.to_string();
    }
    debug!(
        "[AdBypass] stripped {} ad segment(s); {} real remain",
        outcome.dropped, outcome.real
    );
    filtered
}
