use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, DistinguishedName, ServerConfig,
    SignatureScheme,
};
use rustls_pki_types::{CertificateDer, ServerName, UnixTime};
use subtle::ConstantTimeEq;

use crate::{Error, Identity, fingerprint_of_der};

pub(crate) fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// Name sent in the TLS handshake. It is ignored: the Mac is identified by its
/// pinned fingerprint, not by a name.
#[cfg_attr(not(feature = "client"), allow(dead_code))]
pub(crate) fn server_name() -> ServerName<'static> {
    ServerName::try_from("mirna.local").expect("static server name")
}

/// Accepts only the server certificate whose fingerprint was pinned at pairing.
#[derive(Debug)]
struct PinnedServerCert {
    fingerprint: String,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinnedServerCert {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let actual = fingerprint_of_der(end_entity.as_ref());
        if bool::from(actual.as_bytes().ct_eq(self.fingerprint.as_bytes())) {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::InvalidCertificate(
                CertificateError::ApplicationVerificationFailure,
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Requires every client to present a certificate and prove it holds the key.
/// Which certificates are trusted is decided per request by fingerprint, so a
/// phone that is not paired yet can still reach the pairing endpoint.
#[derive(Debug)]
struct AnyClientCert {
    provider: Arc<CryptoProvider>,
}

impl ClientCertVerifier for AnyClientCert {
    fn offer_client_auth(&self) -> bool {
        true
    }

    fn client_auth_mandatory(&self) -> bool {
        true
    }

    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _now: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub(crate) fn server_config(identity: &Identity) -> Result<Arc<ServerConfig>, Error> {
    let provider = provider();
    let config = ServerConfig::builder_with_provider(provider.clone())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_client_cert_verifier(Arc::new(AnyClientCert { provider }))
        .with_single_cert(vec![identity.cert_der()?], identity.key_der()?)?;
    Ok(Arc::new(config))
}

pub(crate) fn client_config(
    identity: &Identity,
    mac_fingerprint: &str,
) -> Result<Arc<ClientConfig>, Error> {
    let provider = provider();
    let mut config = ClientConfig::builder_with_provider(provider.clone())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedServerCert {
            fingerprint: mac_fingerprint.to_ascii_lowercase(),
            provider,
        }))
        .with_client_auth_cert(vec![identity.cert_der()?], identity.key_der()?)?;
    config.enable_sni = false;
    Ok(Arc::new(config))
}

/// Whether an I/O error from a TLS handshake means the pinned fingerprint did
/// not match (a different Mac, or something else, answered).
#[cfg_attr(not(feature = "client"), allow(dead_code))]
pub(crate) fn is_pin_mismatch(error: &std::io::Error) -> bool {
    error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<rustls::Error>())
        .is_some_and(|error| {
            matches!(
                error,
                rustls::Error::InvalidCertificate(CertificateError::ApplicationVerificationFailure)
            )
        })
}
