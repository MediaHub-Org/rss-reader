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
const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (compatible; RSSReader/",
    env!("CARGO_PKG_VERSION"),
    "; +https://localhost/rss-reader)"
);
const ACCEPT: &str =
    "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedResponse {
    pub body: String,
    pub final_url: String,
    pub status: u16,
    pub content_type: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
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

async fn fetch_once(
    client: &reqwest::Client,
    target: Url,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> Result<FeedResponse, String> {
    let mut request = client
        .get(target)
        .header(reqwest::header::ACCEPT, ACCEPT)
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.8");
    if let Some(value) = etag {
        request = request.header(reqwest::header::IF_NONE_MATCH, value);
    }
    if let Some(value) = last_modified {
        request = request.header(reqwest::header::IF_MODIFIED_SINCE, value);
    }

    let response = request.send().await.map_err(|err| {
        if err.is_timeout() {
            "The request timed out.".to_string()
        } else if err.is_connect() {
            format!("Could not connect: {err}")
        } else {
            err.to_string()
        }
    })?;

    let status = response.status();
    let final_url = response.url().to_string();
    let response_etag = header(&response, reqwest::header::ETAG);
    let response_last_modified = header(&response, reqwest::header::LAST_MODIFIED);

    // 304 is the whole point of conditional fetching: keep the cached articles.
    if status == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(FeedResponse {
            body: String::new(),
            final_url,
            status: status.as_u16(),
            content_type: "text/plain; charset=utf-8".into(),
            etag: response_etag,
            last_modified: response_last_modified,
        });
    }

    if !status.is_success() {
        return Err(format!("Upstream returned {status}"));
    }
    if let Some(length) = response.content_length() {
        if length as usize > MAX_BYTES {
            return Err("That feed is larger than 5 MB.".into());
        }
    }

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
        etag: response_etag,
        last_modified: response_last_modified,
    })
}

fn header(response: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
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
/// falls back to plain HTTP when the secure attempt fails. `etag` and
/// `last_modified` enable a conditional request; a 304 keeps the cached articles.
#[tauri::command]
pub async fn fetch_feed(
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<FeedResponse, String> {
    let validated = validate(&url)?;
    let client = http_client()?;

    let mut last_error = "Unable to fetch that feed.".to_string();
    for attempt in attempts_for(&validated) {
        match fetch_once(client, attempt, etag.as_deref(), last_modified.as_deref()).await {
            Ok(response) => return Ok(response),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn one_shot_server(response: &'static str) -> (Url, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 8192];
            let length = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..length]).into_owned();
            stream.write_all(response.as_bytes()).unwrap();
            let _ = stream.flush();
            std::thread::sleep(std::time::Duration::from_millis(20));
            request
        });
        (
            Url::parse(&format!("http://{address}/feed")).unwrap(),
            handle,
        )
    }

    #[tokio::test]
    async fn sends_validators_and_accepts_304() {
        let (url, server) = one_shot_server(
            "HTTP/1.1 304 Not Modified\r\nETag: \"v2\"\r\nConnection: close\r\n\r\n",
        );
        let response = fetch_once(
            &reqwest::Client::new(),
            url,
            Some("\"v1\""),
            Some("Wed, 21 Oct 2015 07:28:00 GMT"),
        )
        .await
        .unwrap();

        assert_eq!(response.status, 304);
        assert_eq!(response.body, "");
        assert_eq!(response.etag.as_deref(), Some("\"v2\""));

        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("if-none-match: \"v1\""));
        assert!(request.contains("if-modified-since: wed, 21 oct 2015 07:28:00 gmt"));
    }

    #[tokio::test]
    async fn returns_validators_from_a_200() {
        let (url, server) = one_shot_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/rss+xml\r\nETag: \"v1\"\r\nLast-Modified: Wed, 21 Oct 2015 07:28:00 GMT\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
        );
        let response = fetch_once(&reqwest::Client::new(), url, None, None)
            .await
            .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "hello");
        assert_eq!(response.etag.as_deref(), Some("\"v1\""));
        assert_eq!(
            response.last_modified.as_deref(),
            Some("Wed, 21 Oct 2015 07:28:00 GMT")
        );
        server.join().unwrap();
    }
}
