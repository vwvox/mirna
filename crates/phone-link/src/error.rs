#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid identity: {0}")]
    InvalidIdentity(String),
    #[error("invalid pairing code: {0}")]
    InvalidOffer(String),
    #[error("the Mac could not be reached")]
    Unreachable,
    #[error("a different Mac answered at this address")]
    MacMismatch,
    #[error("this phone is not paired with the Mac")]
    NotPaired,
    #[error("the pairing code was not accepted")]
    PairingRejected,
    #[error("the Mac already has this recording")]
    AlreadyReceived,
    #[error("upload offset mismatch, the Mac has {received_bytes} bytes")]
    OffsetMismatch { received_bytes: u64 },
    #[error("the Mac answered {status}: {message}")]
    Http { status: u16, message: String },
    #[error("file error: {0}")]
    Io(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("tls error: {0}")]
    Tls(String),
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl From<rustls::Error> for Error {
    fn from(error: rustls::Error) -> Self {
        Self::Tls(error.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::Protocol(error.to_string())
    }
}

impl From<rcgen::Error> for Error {
    fn from(error: rcgen::Error) -> Self {
        Self::InvalidIdentity(error.to_string())
    }
}

impl Error {
    /// Stable machine-readable code for the phone app.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidIdentity(_) => "invalid_identity",
            Self::InvalidOffer(_) => "invalid_offer",
            Self::Unreachable => "unreachable",
            Self::MacMismatch => "mac_mismatch",
            Self::NotPaired => "not_paired",
            Self::PairingRejected => "pairing_rejected",
            Self::AlreadyReceived => "already_received",
            Self::OffsetMismatch { .. } => "offset_mismatch",
            Self::Http { .. } => "http",
            Self::Io(_) => "io",
            Self::Protocol(_) => "protocol",
            Self::Tls(_) => "tls",
        }
    }
}
