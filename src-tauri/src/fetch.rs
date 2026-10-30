//! Native feed fetching for the desktop shell.
//!
//! Replaces the browser's CORS proxy with a direct request from Rust, keeping
//! the same guard rails as `server/proxy-lib.mjs`: http(s) only, HTTPS first,
//! SSRF protection, bounded redirects/time/size and a readable user agent.
//! URL policy lives in `url_policy.rs` so it can be unit-tested on its own.

use crate::url_policy::{https_attempt, validate};
use serde::Serialize;
use std::sync::OnceLock;
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

/// One pooled client for every feed request. Building it once keeps DNS/TLS
/// setup out of each refresh and preserves connection reuse.
fn http_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(build_client)
        .as_ref()
        .map_err(|err| err.clone())
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

fn attempts_for(url: &Url) -> Vec<Url> {
    let mut attempts = Vec::new();
    if url.scheme() == "http" {
        if let Some(https) = https_attempt(url) {
            attempts.push(https);
        }
    }
    attempts.push(url.clone());
    attempts
}

/// Fetch a feed from the desktop app. `http://` is upgraded to HTTPS and only
/// falls back to plain HTTP when the secure attempt fails.
#[tauri::command]
pub async fn fetch_feed(url: String) -> Result<FeedResponse, String> {
    let validated = validate(&url)?;
    let client = http_client()?;

    let mut last_error = "Unable to fetch that feed.".to_string();
    for attempt in attempts_for(&validated) {
        match fetch_once(client, attempt).await {
            Ok(response) => return Ok(response),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}
