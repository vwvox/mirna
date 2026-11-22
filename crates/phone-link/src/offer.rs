use serde::{Deserialize, Serialize};

use crate::Error;
use crate::identity::is_fingerprint;

/// What the Mac's pairing QR code carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairingOffer {
    pub mac_id: String,
    pub mac_name: String,
    /// IPv4 addresses or host names, best first.
    pub addresses: Vec<String>,
    pub port: u16,
    /// SHA-256 of the Mac's certificate, lowercase hex.
    pub fingerprint: String,
    /// Single-use code, valid for a few minutes.
    pub code: String,
}

const SCHEME: &str = "mirna";
const HOST: &str = "pair";

impl PairingOffer {
    pub fn to_uri(&self) -> String {
        let mut url = url::Url::parse(&format!("{SCHEME}://{HOST}")).expect("static url");
        url.query_pairs_mut()
            .append_pair("v", &crate::PROTOCOL_VERSION.to_string())
            .append_pair("id", &self.mac_id)
            .append_pair("n", &self.mac_name)
            .append_pair("a", &self.addresses.join(","))
            .append_pair("p", &self.port.to_string())
            .append_pair("f", &self.fingerprint)
            .append_pair("c", &self.code);
        url.to_string()
    }

    pub fn parse(uri: &str) -> Result<Self, Error> {
        let invalid = |reason: &str| Error::InvalidOffer(reason.to_string());
        let url = url::Url::parse(uri.trim()).map_err(|_| invalid("not a Mirna pairing code"))?;
        if url.scheme() != SCHEME || url.host_str() != Some(HOST) {
            return Err(invalid("not a Mirna pairing code"));
        }

        let mut version = None;
        let mut mac_id = None;
        let mut mac_name = None;
        let mut addresses = None;
        let mut port = None;
        let mut fingerprint = None;
        let mut code = None;
        for (key, value) in url.query_pairs() {
            let value = value.into_owned();
            match key.as_ref() {
                "v" => version = Some(value),
                "id" => mac_id = Some(value),
                "n" => mac_name = Some(value),
                "a" => addresses = Some(value),
                "p" => port = Some(value),
                "f" => fingerprint = Some(value),
                "c" => code = Some(value),
                _ => {}
            }
        }

        if version.as_deref() != Some(&crate::PROTOCOL_VERSION.to_string()) {
            return Err(invalid("made by a different version of Mirna"));
        }
        let fingerprint = fingerprint
            .map(|value| value.to_ascii_lowercase())
            .filter(|value| is_fingerprint(value))
            .ok_or_else(|| invalid("missing the Mac's fingerprint"))?;
        let port = port
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port > 0)
            .ok_or_else(|| invalid("missing the port"))?;
        let code = code
            .filter(|value| {
                (16..=64).contains(&value.len())
                    && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
            })
            .ok_or_else(|| invalid("missing the pairing code"))?;
        let addresses: Vec<String> = addresses
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|value| is_host(value))
            .map(str::to_string)
            .take(8)
            .collect();
        if addresses.is_empty() {
            return Err(invalid("missing the Mac's address"));
        }
        let mac_name = mac_name
            .map(|value| value.trim().chars().take(64).collect::<String>())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Mac".to_string());
        let mac_id = mac_id
            .filter(|value| fingerprint.starts_with(value.as_str()) && !value.is_empty())
            .unwrap_or_else(|| crate::short_id(&fingerprint));

        Ok(Self {
            mac_id,
            mac_name,
            addresses,
            port,
            fingerprint,
            code,
        })
    }
}

fn is_host(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 253
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b':'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offer() -> PairingOffer {
        PairingOffer {
            mac_id: "0123456789abcdef".into(),
            mac_name: "Vera's MacBook Air".into(),
            addresses: vec!["192.168.4.65".into(), "mac.local".into()],
            port: 47823,
            fingerprint: format!("0123456789abcdef{}", "a".repeat(48)),
            code: "ABCDEFGHJKMNPQRSTUVW".into(),
        }
    }

    #[test]
    fn round_trips_through_the_uri() {
        let offer = offer();
        let uri = offer.to_uri();
        assert!(uri.starts_with("mirna://pair?v=1&"));
        assert_eq!(PairingOffer::parse(&uri).unwrap(), offer);
    }

    #[test]
    fn rejects_other_codes() {
        assert!(PairingOffer::parse("https://example.com/?f=1").is_err());
        assert!(PairingOffer::parse("mirna://pair?v=1&p=1").is_err());
        let mut bad = offer();
        bad.fingerprint = "zz".into();
        assert!(PairingOffer::parse(&bad.to_uri()).is_err());
        let mut bad = offer();
        bad.addresses = vec!["bad host!".into()];
        assert!(PairingOffer::parse(&bad.to_uri()).is_err());
    }
}
