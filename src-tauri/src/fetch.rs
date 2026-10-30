//! Native feed fetching for the desktop shell.
//!
//! Replaces the browser's CORS proxy with a direct request from the Rust side,
//! keeping the same guard rails as `server/proxy-lib.mjs`: http(s) only,
//! HTTPS first, SSRF protection, bounded redirects/time/size and a readable
//! user agent. This module is only used by the Tauri app; the web build keeps
//! its layered fetch in `src/lib/fetchFeed.ts`.

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;
use url::Url;

const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const TIMEOUT: Duration = Duration::from_secs(15);
const USER_AGENT: &str = "Mozilla/5.0 (compatible; RSSReader/0.1; +https://localhost/rss-reader)";
const ACCEPT: &str =
    "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedResponse {
    pub body: String,
    pub final_url: String,
    pub status: u16,
    pub content_type: String,
}

fn has_scheme(value: &str) -> bool {
    let Some(colon) = value.find(':') else {
        return false;
    };
    let scheme = &value[..colon];
    let mut chars = scheme.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

fn is_private_v4(v4: Ipv4Addr) -> bool {
    let octets = v4.octets();
    v4.is_private()
        || v4.is_loopback()
        || v4.is_link_local()
        || v4.is_broadcast()
        || v4.is_documentation()
        || v4.is_unspecified()
        || v4.is_multicast()
        || octets[0] == 0
        || octets[0] >= 240
        // 100.64.0.0/10 — carrier-grade NAT
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
}

fn is_private_host(hostname: &str) -> bool {
    let host = hostname
        .trim_matches(|c| c == '[' || c == ']')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        return true;
    }
    if matches!(
        host.as_str(),
        "localhost" | "localhost.localdomain" | "0.0.0.0" | "::1" | "metadata.google.internal"
    ) {
        return true;
    }
    if host.ends_with(".local") || host.ends_with(".internal") {
        return true;
    }

    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => is_private_v4(v4),
        Ok(IpAddr::V6(v6)) => {
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // fc00::/7 — unique local
                || (first & 0xfe00) == 0xfc00
                // fe80::/10 — link local
                || (first & 0xffc0) == 0xfe80
                || v6.to_ipv4_mapped().is_some_and(is_private_v4)
        }
        Err(_) => false,
    }
}

/// Validate a user-supplied URL, mirroring the web proxy's rules.
pub fn validate(raw: &str) -> Result<Url, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("Please enter a feed URL.".into());
    }
    let candidate = if has_scheme(value) {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let url =
        Url::parse(&candidate).map_err(|_| "That does not look like a valid URL.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http(s) feed URLs are supported.".into());
    }
    let host = url.host_str().ok_or("That URL has no host.")?;
    if is_private_host(host) {
        return Err("That host is not reachable from the app.".into());
    }
    Ok(url)
}

fn https_attempt(url: &Url) -> Option<Url> {
    let mut https = url.clone();
    https.set_scheme("https").ok()?;
    if https.port() == Some(80) {
        let _ = https.set_port(None);
    }
    Some(https)
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error(std::io::Error::other("Too many redirects"));
            }
            match validate(attempt.url().as_str()) {
                Ok(_) => attempt.follow(),
                Err(message) => attempt.error(std::io::Error::other(message)),
            }
        }))
        .timeout(TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|err| err.to_string())
}

async fn fetch_once(client: &reqwest::Client, target: Url) -> Result<FeedResponse, String> {
    let response = client
        .get(target)
        .header(reqwest::header::ACCEPT, ACCEPT)
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.8")
        .send()
        .await
        .map_err(|err| {
            if err.is_timeout() {
                "The request timed out.".to_string()
            } else if err.is_connect() {
                format!("Could not connect: {err}")
            } else {
                err.to_string()
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Upstream returned {status}"));
    }
    if let Some(length) = response.content_length() {
        if length as usize > MAX_BYTES {
            return Err("That feed is larger than 5 MB.".into());
        }
    }

    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_string();

    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("That feed is larger than 5 MB.".into());
    }
    if bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Err("The feed returned an empty response.".into());
    }

    Ok(FeedResponse {
        body: String::from_utf8_lossy(&bytes).into_owned(),
        final_url,
        status: status.as_u16(),
        content_type,
    })
}

/// Fetch a feed from the desktop app. `http://` is upgraded to HTTPS and only
/// falls back to plain HTTP when the secure attempt fails.
#[tauri::command]
pub async fn fetch_feed(url: String) -> Result<FeedResponse, String> {
    let validated = validate(&url)?;
    let mut attempts = Vec::new();
    if validated.scheme() == "http" {
        if let Some(https) = https_attempt(&validated) {
            attempts.push(https);
        }
    }
    attempts.push(validated);

    let client = build_client()?;
    let mut last_error = "Unable to fetch that feed.".to_string();
    for attempt in attempts {
        match fetch_once(&client, attempt).await {
            Ok(response) => return Ok(response),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}
