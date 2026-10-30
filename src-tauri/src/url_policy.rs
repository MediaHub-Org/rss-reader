//! URL policy shared by feed fetching and external-link opening.
//!
//! Mirrors `server/proxy-lib.mjs`: http(s) only, no local/private targets,
//! HTTPS preferred.

use std::net::{IpAddr, Ipv4Addr};
use url::Url;

pub fn has_scheme(value: &str) -> bool {
    let Some(colon) = value.find(':') else {
        return false;
    };
    let scheme = &value[..colon];
    let mut chars = scheme.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

fn is_private_v4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_unspecified()
        || address.is_multicast()
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

/// Validate a user-supplied URL and canonicalise a bare host to HTTPS.
pub fn validate(raw: &str) -> Result<Url, String> {
    let url = parse_http_url(raw)?;
    let host = url.host_str().ok_or("That URL has no host.")?;
    if is_private_host(host) {
        return Err("That host is not reachable from the app.".into());
    }
    Ok(url)
}

/// Like `validate`, but allows private hosts: this is for links the user
/// explicitly opens in their browser, not for server-side fetching.
pub fn validate_external(raw: &str) -> Result<Url, String> {
    parse_http_url(raw)
}

fn parse_http_url(raw: &str) -> Result<Url, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("Please enter a URL.".into());
    }
    let candidate = if has_scheme(value) {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let url =
        Url::parse(&candidate).map_err(|_| "That does not look like a valid URL.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http(s) URLs are supported.".into());
    }
    Ok(url)
}

/// The HTTPS version of an `http://` URL, dropping the default port.
pub fn https_attempt(url: &Url) -> Option<Url> {
    let mut https = url.clone();
    https.set_scheme("https").ok()?;
    if https.port() == Some(80) {
        let _ = https.set_port(None);
    }
    Some(https)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_schemes() {
        assert!(has_scheme("https://example.com/feed"));
        assert!(has_scheme("http://example.com"));
        assert!(!has_scheme("example.com/feed"));
        assert!(!has_scheme("/feed.xml"));
        assert!(!has_scheme(""));
    }

    #[test]
    fn blocks_private_hosts() {
        for host in [
            "localhost",
            "localhost.",
            "localhost.localdomain",
            "0.0.0.0",
            "127.0.0.1",
            "127.9.9.9",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "224.0.0.1",
            "240.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "printer.local",
            "metadata.google.internal",
        ] {
            assert!(is_private_host(host), "{host} should be private");
        }
    }

    #[test]
    fn allows_public_hosts() {
        for host in [
            "example.com",
            "feeds.bbci.co.uk",
            "8.8.8.8",
            "1.1.1.1",
            "2606:4700:4700::1111",
        ] {
            assert!(!is_private_host(host), "{host} should be public");
        }
    }

    #[test]
    fn validates_urls() {
        assert!(validate("https://example.com/feed.xml").is_ok());
        assert_eq!(
            validate("example.com/feed.xml").unwrap().as_str(),
            "https://example.com/feed.xml"
        );
        assert!(validate("http://example.com/feed").is_ok());
        assert!(validate("ftp://example.com/feed").is_err());
        assert!(validate("javascript:alert(1)").is_err());
        assert!(validate("file:///etc/passwd").is_err());
        assert!(validate("http://localhost/feed").is_err());
        assert!(validate("http://[::1]/feed").is_err());
        assert!(validate("   ").is_err());
    }

    #[test]
    fn external_links_allow_private_hosts_but_not_other_schemes() {
        assert!(validate_external("http://localhost:8080/article").is_ok());
        assert!(validate_external("http://192.168.1.5/").is_ok());
        assert_eq!(
            validate_external("example.com/page").unwrap().as_str(),
            "https://example.com/page"
        );
        assert!(validate_external("file:///etc/passwd").is_err());
        assert!(validate_external("javascript:alert(1)").is_err());
    }

    #[test]
    fn upgrades_http_to_https() {
        let http = Url::parse("http://example.com:80/feed.xml").unwrap();
        let https = https_attempt(&http).unwrap();
        assert_eq!(https.as_str(), "https://example.com/feed.xml");

        let custom = Url::parse("http://example.com:8080/feed.xml").unwrap();
        assert_eq!(
            https_attempt(&custom).unwrap().as_str(),
            "https://example.com:8080/feed.xml"
        );
    }
}
