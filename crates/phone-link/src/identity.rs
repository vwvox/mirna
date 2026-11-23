use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::Error;

/// A device's long-lived TLS identity: a self-signed P-256 certificate and its
/// private key, both PEM. The key never leaves the device that made it.
#[derive(Clone, Serialize, Deserialize)]
pub struct Identity {
    pub cert_pem: String,
    pub key_pem: String,
}

impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Identity")
            .field("fingerprint", &self.fingerprint().ok())
            .finish_non_exhaustive()
    }
}

impl Identity {
    pub fn generate() -> Result<Self, Error> {
        let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256)?;
        let mut params = rcgen::CertificateParams::new(vec!["mirna.local".to_string()])?;
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "Mirna");
        let cert = params.self_signed(&key)?;
        Ok(Self {
            cert_pem: cert.pem(),
            key_pem: key.serialize_pem(),
        })
    }

    /// Lowercase hex SHA-256 of the certificate's DER encoding.
    pub fn fingerprint(&self) -> Result<String, Error> {
        Ok(fingerprint_of_der(self.cert_der()?.as_ref()))
    }

    pub(crate) fn cert_der(&self) -> Result<CertificateDer<'static>, Error> {
        CertificateDer::from_pem_slice(self.cert_pem.as_bytes())
            .map_err(|error| Error::InvalidIdentity(format!("certificate: {error}")))
    }

    pub(crate) fn key_der(&self) -> Result<PrivateKeyDer<'static>, Error> {
        PrivateKeyDer::from_pem_slice(self.key_pem.as_bytes())
            .map_err(|error| Error::InvalidIdentity(format!("key: {error}")))
    }

    /// Checks that the certificate and key parse and belong together.
    pub fn validate(&self) -> Result<(), Error> {
        crate::tls::client_config(self, &"0".repeat(64)).map(|_| ())
    }
}

pub fn fingerprint_of_der(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}

/// Short, stable identifier derived from a fingerprint (first 16 hex digits).
pub fn short_id(fingerprint: &str) -> String {
    fingerprint.chars().take(16).collect()
}

pub(crate) fn is_fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
