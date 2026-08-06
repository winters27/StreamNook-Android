//! Ad-free master acquisition: race the relay pool, validate, splice.
//!
//! Ported from StreamNook 7.8.6 (`services/auth_proxy.rs` at `2bf9720`), where
//! this ran inside the core relay before resolution became a plugin hook.
//! Android can't host that plugin (it is a spawned native child process, which
//! the platform sandbox forbids), so the same logic lives here behind an
//! Android-only module instead.

use anyhow::{anyhow, Result};
use futures::stream::{FuturesUnordered, StreamExt};
use log::{debug, info};
use std::collections::HashSet;
use std::time::Duration;

use super::proxies;
use crate::services::auth_proxy::{extract_attr, USER_AGENT};

/// Per-request budget for a relay. Short on purpose: the pool is raced, so a
/// slow relay simply loses to a fast one.
const RACE_TIMEOUT: Duration = Duration::from_secs(8);

/// True if `body` is actually an HLS master playlist (carries at least one
/// `#EXT-X-STREAM-INF`). The relays are flaky and routinely answer with HTTP
/// 200 plus an HTML "Server error!" page or a JSON `{"error":...}` body;
/// without this check those sail past the status test into the parser, which
/// then finds no variants and fails the whole stream. Treating a non-master 2xx
/// as a miss lets the race try another relay and ultimately fall back to the
/// direct master.
pub fn looks_like_master(body: &str) -> bool {
    body.contains("#EXT-X-STREAM-INF")
}

/// Percent-encodes everything except RFC 3986 unreserved chars + `:` and `/`.
///
/// The relays require URLs in this mangled shape: the query separators `?`,
/// `=`, `&` and `,` become `%3F`, `%3D`, `%26`, `%2C`, so the whole query rides
/// inside the URL path. A clean `?param=value` URL gets a 500 instead.
/// Re-confirmed live against the pool on 2026-08-06.
fn quote_safe_colon_slash(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        let safe = matches!(ch,
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '.' | '_' | '~' | ':' | '/'
        );
        if safe {
            out.push(ch);
        } else {
            let mut buf = [0u8; 4];
            for b in ch.encode_utf8(&mut buf).as_bytes() {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

/// The playlist URL for one relay base.
fn playlist_url(base: &str, channel: &str) -> String {
    let raw = format!(
        "{}/playlist/{}.m3u8?platform=web&allow_source=true&allow_audio_only=true&fast_bread=true&supported_codecs=av1,h264,h265",
        base.trim_end_matches('/'),
        channel
    );
    quote_safe_colon_slash(&raw)
}

/// GET an anonymous, region-shifted master playlist. Races every base in
/// parallel and returns the first 2xx whose body is a real master playlist, as
/// `(winning_base, master_body)`.
async fn fetch_racing(channel: &str, bases: &[String]) -> Result<(String, String)> {
    if bases.is_empty() {
        return Err(anyhow!("no relay bases configured"));
    }
    let client = crate::services::http::client();

    let mut futs = FuturesUnordered::new();
    for base in bases {
        let url = playlist_url(base, channel);
        let label = base.clone();
        futs.push(async move {
            let resp = client
                .get(&url)
                .timeout(RACE_TIMEOUT)
                .header("User-Agent", USER_AGENT)
                .header("Referer", "https://player.twitch.tv")
                .header("Origin", "https://player.twitch.tv")
                .send()
                .await
                .map_err(|e| anyhow!("{} → {}", label, e))?;
            if !resp.status().is_success() {
                return Err(anyhow!("{} → HTTP {}", label, resp.status()));
            }
            let body = resp
                .text()
                .await
                .map_err(|e| anyhow!("{} → body: {}", label, e))?;
            if !looks_like_master(&body) {
                let first = body.lines().next().unwrap_or("").trim().to_string();
                return Err(anyhow!(
                    "{} → 2xx but not a master playlist ({} bytes, first line: {:?})",
                    label,
                    body.len(),
                    first
                ));
            }
            Ok::<(String, String), anyhow::Error>((label, body))
        });
    }

    let mut last_err: Option<anyhow::Error> = None;
    while let Some(res) = futs.next().await {
        match res {
            Ok((label, body)) => {
                debug!("[AdBypass] relay winner: {}", label);
                return Ok((label, body));
            }
            Err(e) => {
                debug!("[AdBypass] relay miss: {}", e);
                last_err = Some(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow!("every relay failed")))
}

/// Race `preferred` first; if they ALL fail, race the rest of the bundled pool.
/// One relay going down must not take ad-free playback down with it: as long as
/// any relay is alive we serve an ad-free master. `preferred` is the user's
/// override when they set one, and the pivot's untried-bases list when it is
/// escalating.
pub async fn fetch_with_fallback(channel: &str, preferred: &[String]) -> Result<(String, String)> {
    let err = match fetch_racing(channel, preferred).await {
        Ok(win) => return Ok(win),
        Err(e) => e,
    };
    let tried: HashSet<&str> = preferred.iter().map(|s| s.trim_end_matches('/')).collect();
    let rest: Vec<String> = proxies::bundled()
        .into_iter()
        .filter(|u| !tried.contains(u.as_str()))
        .collect();
    if rest.is_empty() {
        return Err(err);
    }
    debug!(
        "[AdBypass] {} preferred relays failed ({}); falling back to {} bundled relays",
        channel,
        err,
        rest.len()
    );
    fetch_racing(channel, &rest).await
}

/// Parse the height (e.g. `1440`) from a `NAME="1440p60"` attribute.
fn parse_name_height(line: &str) -> Option<u32> {
    let pos = line.find("NAME=\"")? + 6;
    let rest = &line[pos..];
    let end = rest.find('"')?;
    let digits: String = rest[..end].chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// The video height of an `#EXT-X-STREAM-INF` line, from `RESOLUTION=WxH` or
/// the `NAME`/`IVS-NAME` label. None for audio-only.
fn stream_inf_height(inf: &str) -> Option<u32> {
    let res = extract_attr(inf, "RESOLUTION").and_then(|r| {
        r.split(['x', 'X'])
            .nth(1)
            .and_then(|h| h.trim().parse::<u32>().ok())
    });
    match (res, parse_name_height(inf)) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

/// Every video height a master offers.
fn heights(master: &str) -> HashSet<u32> {
    master
        .lines()
        .filter(|l| l.trim_start().starts_with("#EXT-X-STREAM-INF:"))
        .filter_map(stream_inf_height)
        .collect()
}

/// The playlist blocks in `master` for heights `have` does not already cover.
///
/// Anchored on `#EXT-X-STREAM-INF` (same as the resolver's parser) so it works
/// on both master layouts, and each block carries the preceding legacy
/// `#EXT-X-MEDIA` tag when there is one so the quality label survives. The URLs
/// are copied verbatim, which is what carries the geo-unlocked tiers through:
/// by the time the master reaches us those already point at the region relay's
/// media proxy, and rewriting them would undo the unlock.
fn missing_tier_blocks(master: &str, have: &HashSet<u32>) -> Vec<String> {
    let lines: Vec<&str> = master.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let inf = lines[i];
        if !inf.trim_start().starts_with("#EXT-X-STREAM-INF:") {
            i += 1;
            continue;
        }
        // URL = next non-comment, non-empty line.
        let mut j = i + 1;
        while j < lines.len() && (lines[j].trim().is_empty() || lines[j].trim_start().starts_with('#'))
        {
            j += 1;
        }
        if j >= lines.len() {
            break;
        }
        if let Some(h) = stream_inf_height(inf) {
            if !have.contains(&h) {
                let mut block = String::new();
                if i > 0 {
                    let prev = lines[i - 1].trim_start();
                    if prev.starts_with("#EXT-X-MEDIA:") && prev.contains("TYPE=VIDEO") {
                        block.push_str(lines[i - 1]);
                        block.push('\n');
                    }
                }
                block.push_str(inf);
                block.push('\n');
                block.push_str(lines[j].trim());
                out.push(block);
            }
        }
        i = j + 1;
    }
    out
}

/// Keep the relay master as the base, then append every tier the viewer's own
/// master has that the relay's lacks.
///
/// 7.8.6 grafted only above 1080p, on the assumption that a relay always serves
/// the full ladder up to FULL_HD. Measured against the live pool on 2026-08-06
/// that does not hold: for the same channel at the same moment, some relays
/// answered with a ladder topping out at 720p while others reached 1080p, and
/// the race is won on speed. Keying on "which heights are missing" instead of a
/// fixed 1080 line keeps the viewer's full quality menu no matter which relay
/// wins, and is also what carries the geo-unlocked 1440p tier through, since by
/// then it is simply another tier the relay master does not have.
///
/// A grafted tier is the viewer's own stream, so it can carry ads that the
/// relay's tiers would not. The playlist filter strips those as they are
/// served, which is the same defense that covers a relay leaking an ad.
pub fn splice(relay_master: &str, auth_master: &str) -> String {
    let have = heights(relay_master);
    let mut out = relay_master.trim_end().to_string();
    for block in missing_tier_blocks(auth_master, &have) {
        // Log the real RESOLUTION/CODECS of each grafted variant: this is the
        // proof that a tier labeled "1440p60" really points at a 2560x1440
        // variant from the authenticated master, not a relabeled lower tier.
        if let Some(inf) = block.lines().find(|l| l.starts_with("#EXT-X-STREAM-INF:")) {
            info!(
                "[AdBypass] spliced variant VIDEO={} RESOLUTION={} CODECS={}",
                extract_attr(inf, "VIDEO").unwrap_or_else(|| "?".into()),
                extract_attr(inf, "RESOLUTION").unwrap_or_else(|| "?".into()),
                extract_attr(inf, "CODECS").unwrap_or_else(|| "?".into()),
            );
        }
        out.push('\n');
        out.push_str(&block);
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUTH_MASTER: &str = "#EXTM3U\n\
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"chunked\",NAME=\"1440p60\"\n\
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=2560x1440,CODECS=\"av01.0.08M.08\",VIDEO=\"chunked\"\n\
https://cdn/auth-1440.m3u8\n\
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"1080p60\",NAME=\"1080p60\"\n\
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS=\"avc1.64002A\",VIDEO=\"1080p60\"\n\
https://cdn/auth-1080.m3u8\n";

    const RELAY_MASTER: &str = "#EXTM3U\n\
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS=\"avc1.64002A\",VIDEO=\"1080p60\"\n\
https://cdn/relay-1080.m3u8\n";

    #[test]
    fn the_query_rides_inside_the_path() {
        let url = playlist_url("https://relay.example.com/", "shroud");
        assert!(url.starts_with("https://relay.example.com/playlist/shroud.m3u8%3F"));
        assert!(url.contains("platform%3Dweb"));
        assert!(url.contains("%26allow_source%3Dtrue"));
        assert!(!url.contains('?'), "a clean query gets 500'd by the relays");
    }

    #[test]
    fn splice_grafts_the_1440p_tier() {
        let out = splice(RELAY_MASTER, AUTH_MASTER);
        assert!(out.contains("https://cdn/relay-1080.m3u8"), "{out}");
        assert!(out.contains("https://cdn/auth-1440.m3u8"), "{out}");
        assert!(out.contains("RESOLUTION=2560x1440"), "{out}");
        assert!(out.contains("NAME=\"1440p60\""), "the label rides along: {out}");
        assert!(
            !out.contains("https://cdn/auth-1080.m3u8"),
            "a tier the relay already serves is never swapped for the ad-bearing one: {out}"
        );
    }

    #[test]
    fn splice_adds_nothing_when_the_relay_covers_every_tier() {
        let auth_1080_only = "#EXTM3U\n\
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\nhttps://cdn/auth-1080.m3u8\n";
        assert_eq!(splice(RELAY_MASTER, auth_1080_only), RELAY_MASTER);
    }

    #[test]
    fn splice_restores_a_tier_the_winning_relay_capped_away() {
        // Measured live: relays for one channel disagree about the top of the
        // ladder, and the race is won on speed. A 720p relay must not cost the
        // viewer 1080p.
        let capped_relay = "#EXTM3U\n\
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\nhttps://cdn/relay-720.m3u8\n";
        let out = splice(capped_relay, AUTH_MASTER);
        assert!(out.contains("https://cdn/relay-720.m3u8"), "{out}");
        assert!(out.contains("https://cdn/auth-1080.m3u8"), "{out}");
        assert!(out.contains("https://cdn/auth-1440.m3u8"), "{out}");
    }

    #[test]
    fn a_geo_unlocked_tier_keeps_its_relay_routed_url() {
        // The region-unlock splice upstream has already pointed this tier's
        // playlist at the quality relay. Rewriting it here would re-block it.
        let auth = "#EXTM3U\n\
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=2560x1440,VIDEO=\"chunked\"\n\
https://modroom.streamnook.app/quality-media?u=https%3A%2F%2Fcdn%2F1440.m3u8\n";
        let out = splice(RELAY_MASTER, auth);
        assert!(
            out.contains("https://modroom.streamnook.app/quality-media?u=https%3A%2F%2Fcdn%2F1440.m3u8"),
            "{out}"
        );
    }

    #[test]
    fn height_comes_from_the_name_when_resolution_is_absent() {
        assert_eq!(
            parse_name_height(r#"#EXT-X-STREAM-INF:IVS-NAME="1440p60""#),
            Some(1440)
        );
        assert_eq!(parse_name_height(r#"#EXT-X-MEDIA:NAME="audio_only""#), None);
    }

    #[test]
    fn only_real_masters_pass_validation() {
        assert!(looks_like_master("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nurl\n"));
        assert!(!looks_like_master("<html>Server error!</html>"));
        assert!(!looks_like_master("{\"error\":\"no channel\"}"));
    }
}
