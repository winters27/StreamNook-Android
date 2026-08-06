//! Escape a relay that is serving nothing but ads.
//!
//! Stripping handles a leaked ad seamlessly, with no reload and no gap. It
//! can't help when the relay's whole window is ads: there is no real segment
//! left to serve. That is the rare case this handles, by re-resolving the same
//! channel through a region we haven't tried yet and hot-swapping the relay's
//! upstream underneath the player.
//!
//! Guardrails carried over from 7.8.6: fire only on a debounced confirmation
//! (one unlucky poll is not an ad window), and hold a cooldown afterwards so a
//! slow connection can't be thrashed. Only a relayed stream ever arms this:
//! an entitled or direct stream has nowhere else to go.

use log::{error, info, warn};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;

use crate::services::twitch_auth_service::TwitchAuthService;

/// Consecutive all-ad polls before escalating.
const DEBOUNCE_POLLS: u32 = 2;
/// Minimum gap between two escalations.
const COOLDOWN: Duration = Duration::from_secs(30);

/// Everything needed to re-resolve the stream now playing.
struct ActiveStream {
    channel: String,
    quality: String,
    /// The user's relay preference list (or the bundled pool).
    configured: Vec<String>,
    /// Bases already known to be serving ads for this stream.
    tried: Vec<String>,
    auth: TwitchAuthService,
    last_pivot: Option<Instant>,
    in_flight: bool,
}

static ACTIVE: Lazy<Mutex<Option<ActiveStream>>> = Lazy::new(|| Mutex::new(None));
static EMPTY_POLLS: AtomicU32 = AtomicU32::new(0);

/// Arm escalation for a stream that resolved through `base`.
pub fn arm(
    channel: String,
    quality: String,
    configured: Vec<String>,
    base: String,
    auth: TwitchAuthService,
) {
    *ACTIVE.lock().unwrap() = Some(ActiveStream {
        channel,
        quality,
        configured,
        tried: vec![base],
        auth,
        last_pivot: None,
        in_flight: false,
    });
    EMPTY_POLLS.store(0, Ordering::Relaxed);
}

/// Disarm (stream stopped, or this stream isn't using a relay).
pub fn disarm() {
    *ACTIVE.lock().unwrap() = None;
    EMPTY_POLLS.store(0, Ordering::Relaxed);
}

/// Reset the in-flight flag and start a cooldown, so a failed escalation
/// doesn't hammer re-resolution while ads keep leaking.
fn end_with_cooldown() {
    if let Some(a) = ACTIVE.lock().unwrap().as_mut() {
        a.in_flight = false;
        a.last_pivot = Some(Instant::now());
    }
    EMPTY_POLLS.store(0, Ordering::Relaxed);
}

/// Called once per served playlist with "stripping left nothing playable".
/// Non-blocking: the escalation runs on its own task.
pub fn maybe_trigger(all_ads: bool) {
    if !all_ads {
        EMPTY_POLLS.store(0, Ordering::Relaxed);
        return;
    }
    if EMPTY_POLLS.fetch_add(1, Ordering::Relaxed) + 1 < DEBOUNCE_POLLS {
        return;
    }
    let go = {
        let mut guard = ACTIVE.lock().unwrap();
        match guard.as_mut() {
            Some(a) if !a.in_flight && a.last_pivot.is_none_or(|t| t.elapsed() >= COOLDOWN) => {
                a.in_flight = true;
                true
            }
            _ => false,
        }
    };
    if go {
        tokio::spawn(run());
    }
}

async fn run() {
    // Prefer regions this stream hasn't been served ads by. Once every base has
    // been tried, let the race pick anything again rather than giving up.
    let (channel, quality, preferred, auth) = {
        let guard = ACTIVE.lock().unwrap();
        let Some(a) = guard.as_ref() else { return };
        let untried: Vec<String> = a
            .configured
            .iter()
            .filter(|b| !a.tried.contains(b))
            .cloned()
            .collect();
        let preferred = if untried.is_empty() {
            a.configured.clone()
        } else {
            untried
        };
        (
            a.channel.clone(),
            a.quality.clone(),
            preferred,
            a.auth.clone(),
        )
    };

    // Re-fetch the viewer's own master too: its above-1080p tiers are signed
    // URLs, so the ones from the original resolve are no use by now.
    let oauth = auth.get_token().await.ok();
    let core = crate::services::twitch_resolver::resolve_live(&channel, oauth.as_deref(), &quality)
        .await
        .ok();

    let Some((resolved, base)) =
        super::resolve_through_relay(&channel, &quality, core.as_ref(), &preferred).await
    else {
        warn!("[AdBypass] {} found no clean relay to escalate to", channel);
        end_with_cooldown();
        return;
    };

    match crate::services::stream_server::swap_upstream(resolved.url.clone()).await {
        Ok(()) => {
            crate::services::auth_proxy::set_status(resolved.status.clone());
            {
                let mut guard = ACTIVE.lock().unwrap();
                if let Some(a) = guard.as_mut() {
                    if !a.tried.contains(&base) {
                        a.tried.push(base);
                    }
                    a.last_pivot = Some(Instant::now());
                    a.in_flight = false;
                }
            }
            EMPTY_POLLS.store(0, Ordering::Relaxed);
            info!(
                "[AdBypass] {} escalated to region {:?} after an all-ad window",
                channel, resolved.status.proxy_region
            );
        }
        Err(e) => {
            error!("[AdBypass] {} upstream swap failed: {}", channel, e);
            end_with_cooldown();
        }
    }
}
