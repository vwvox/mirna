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

/// Largest phone problem log the Mac keeps.
pub const MAX_DIAGNOSTICS_BYTES: usize = 1024 * 1024;

/// What is left of a WAV file after [`trim_wav_file`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrimmedWav {
    pub data_bytes: u64,
    pub duration_ms: u64,
}

/// Cuts a PCM WAV file after its first `keep_ms`, in place: the data chunk is
/// shortened, the header sizes are rewritten and the file is truncated.
/// Asking to keep more than the file holds changes nothing.
pub fn trim_wav_file(path: &std::path::Path, keep_ms: u64) -> std::io::Result<TrimmedWav> {
    use std::io::{Read, Seek, SeekFrom, Write};
    let invalid = |message: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, message);
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?;
    let file_len = file.metadata()?.len();
    let mut riff = [0u8; 12];
    file.read_exact(&mut riff)?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err(invalid("not a WAV file"));
    }
    let mut byte_rate: Option<u64> = None;
    let mut block_align: u64 = 1;
    let mut offset: u64 = 12;
    loop {
        if offset + 8 > file_len {
            return Err(invalid("WAV file has no data"));
        }
        file.seek(SeekFrom::Start(offset))?;
        let mut header = [0u8; 8];
        file.read_exact(&mut header)?;
        let size = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as u64;
        let body = offset + 8;
        if &header[0..4] == b"fmt " {
            let mut format = [0u8; 16];
            file.read_exact(&mut format)?;
            byte_rate =
                Some(u32::from_le_bytes([format[8], format[9], format[10], format[11]]) as u64);
            block_align = (u16::from_le_bytes([format[12], format[13]]) as u64).max(1);
        } else if &header[0..4] == b"data" {
            let byte_rate = byte_rate
                .filter(|rate| *rate > 0)
                .ok_or_else(|| invalid("WAV file has no format"))?;
            // A header written mid-recording may undercount; the file is the truth.
            let available = file_len.saturating_sub(body);
            let wanted = keep_ms.saturating_mul(byte_rate) / 1000;
            let data_bytes = wanted.min(available) / block_align * block_align;
            let new_len = body + data_bytes;
            file.seek(SeekFrom::Start(offset + 4))?;
            file.write_all(&(data_bytes.min(u32::MAX as u64) as u32).to_le_bytes())?;
            file.seek(SeekFrom::Start(4))?;
            file.write_all(&((new_len - 8).min(u32::MAX as u64) as u32).to_le_bytes())?;
            file.set_len(new_len)?;
            file.sync_all()?;
            return Ok(TrimmedWav {
                data_bytes,
                duration_ms: data_bytes * 1000 / byte_rate,
            });
        }
        offset = body + size + (size & 1);
    }
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
