//! Pairing and recording transfer between the Mirna phone app and the Mac.
//!
//! Everything travels over the local network inside mutual TLS 1.3. There is
//! no certificate authority and no server in between: each side pins the
//! other's self-signed certificate by its SHA-256 fingerprint.
//!
//! - The Mac's fingerprint reaches the phone in the pairing QR code.
//! - The phone's fingerprint reaches the Mac during pairing, inside a TLS
//!   session that the phone has already pinned to the Mac, together with the
//!   single-use code from the same QR code.

mod error;
pub mod identity;
pub mod offer;
pub mod protocol;
mod tls;

#[cfg(feature = "client")]
pub mod client;
#[cfg(feature = "server")]
pub mod server;

pub use error::Error;
pub use identity::{Identity, fingerprint_of_der, short_id};
pub use offer::PairingOffer;

/// Port the Mac listens on when it is free. The QR code and the Bonjour
/// record always carry the real port, so a fallback port still works.
pub const DEFAULT_PORT: u16 = 47823;

/// Bonjour / DNS-SD service type the Mac advertises.
pub const SERVICE_TYPE: &str = "_mirna._tcp.local.";

/// Largest body of one upload request.
pub const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;

/// Largest recording the Mac accepts (about 9 hours of 16 kHz mono WAV).
pub const MAX_RECORDING_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Protocol version carried in the QR code and in `/v1/info`.
pub const PROTOCOL_VERSION: u32 = 1;

/// Audio file types the Mac imports (same list as the desktop importer).
pub const AUDIO_EXTENSIONS: &[&str] = &["wav", "mp3", "ogg", "mp4", "m4a", "flac", "webm", "aac"];

#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

/// Lowercase hex SHA-256 of a file, read in 1 MiB blocks.
pub fn sha256_file(path: &std::path::Path) -> std::io::Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}
