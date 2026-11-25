//! Phone side: talks to the paired Mac.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{Method, Request, StatusCode};
use serde::de::DeserializeOwned;
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;

use crate::Error;
use crate::identity::{Identity, is_fingerprint};
use crate::protocol::{
    ChunkResponse, CompleteRequest, ErrorBody, MacInfo, NoteChangesRequest, NoteChangesResponse,
    NoteJob, PairRequest, PairResponse, RecordingStatus, StatusesRequest,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(6);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Where to find the paired Mac.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MacTarget {
    /// Addresses to try, best first.
    pub hosts: Vec<String>,
    pub port: u16,
    pub fingerprint: String,
}

pub struct Client {
    connector: TlsConnector,
    target: MacTarget,
    working_host: Mutex<Option<String>>,
}

impl Client {
    pub fn new(identity: &Identity, target: MacTarget) -> Result<Self, Error> {
        let fingerprint = target.fingerprint.to_ascii_lowercase();
        if !is_fingerprint(&fingerprint) {
            return Err(Error::InvalidOffer("bad Mac fingerprint".into()));
        }
        if target.hosts.is_empty() {
            return Err(Error::Unreachable);
        }
        let config = crate::tls::client_config(identity, &fingerprint)?;
        Ok(Self {
            connector: TlsConnector::from(Arc::clone(&config)),
            target: MacTarget {
                fingerprint,
                ..target
            },
            working_host: Mutex::new(None),
        })
    }

    /// The address that answered last, so the app can try it first next time.
    pub fn working_host(&self) -> Option<String> {
        self.working_host.lock().ok().and_then(|host| host.clone())
    }

    pub async fn info(&self) -> Result<MacInfo, Error> {
        self.call(Method::GET, "/v1/info", None).await
    }

    pub async fn pair(&self, code: &str, phone_name: &str) -> Result<PairResponse, Error> {
        let body = serde_json::to_vec(&PairRequest {
            code: code.to_string(),
            phone_name: phone_name.to_string(),
        })?;
        match self.call(Method::POST, "/v1/pair", Some(body.into())).await {
            Err(Error::Http { status: 403, .. }) => Err(Error::PairingRejected),
            other => other,
        }
    }

    pub async fn status(&self, recording_id: &str) -> Result<RecordingStatus, Error> {
        self.call(Method::GET, &format!("/v1/recordings/{recording_id}"), None)
            .await
    }

    pub async fn statuses(&self, ids: &[String]) -> Result<Vec<RecordingStatus>, Error> {
        let body = serde_json::to_vec(&StatusesRequest { ids: ids.to_vec() })?;
        self.call(Method::POST, "/v1/statuses", Some(body.into()))
            .await
    }

    /// Notes from this phone's recordings whose text changed on the Mac since
    /// `since` (the cursor from the last call, or 0), and, if asked, notes
    /// recorded on the Mac.
    pub async fn note_changes(
        &self,
        since: u64,
        include_mac_notes: bool,
    ) -> Result<NoteChangesResponse, Error> {
        let body = serde_json::to_vec(&NoteChangesRequest {
            since,
            include_mac_notes,
        })?;
        self.call(Method::POST, "/v1/notes/changes", Some(body.into()))
            .await
    }

    /// Asks the Mac to try a recording it couldn't turn into a note again.
    pub async fn retry(&self, recording_id: &str) -> Result<RecordingStatus, Error> {
        self.call(
            Method::POST,
            &format!("/v1/recordings/{recording_id}/retry"),
            Some(Bytes::from_static(b"{}")),
        )
        .await
    }

    /// Asks the Mac to transcribe a recording again or cut its end.
    pub async fn note_job(
        &self,
        recording_id: &str,
        job: &NoteJob,
    ) -> Result<RecordingStatus, Error> {
        let body = serde_json::to_vec(job)?;
        self.call(
            Method::POST,
            &format!("/v1/recordings/{recording_id}/job"),
            Some(body.into()),
        )
        .await
    }

    /// Sends this phone's problem log, replacing the copy the Mac has.
    pub async fn upload_diagnostics(&self, log: Bytes) -> Result<(), Error> {
        let _: serde_json::Value = self.call(Method::PUT, "/v1/diagnostics", Some(log)).await?;
        Ok(())
    }

    /// Sends bytes that start at `offset` of the recording. Returns how many
    /// bytes the Mac now holds.
    pub async fn upload_chunk(
        &self,
        recording_id: &str,
        offset: u64,
        data: Bytes,
    ) -> Result<u64, Error> {
        let response: ChunkResponse = self
            .call(
                Method::PUT,
                &format!("/v1/recordings/{recording_id}/audio?offset={offset}"),
                Some(data),
            )
            .await?;
        Ok(response.received_bytes)
    }

    pub async fn complete(
        &self,
        recording_id: &str,
        request: &CompleteRequest,
    ) -> Result<RecordingStatus, Error> {
        let body = serde_json::to_vec(request)?;
        self.call(
            Method::POST,
            &format!("/v1/recordings/{recording_id}/complete"),
            Some(body.into()),
        )
        .await
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Bytes>,
    ) -> Result<T, Error> {
        let (status, bytes) = tokio::time::timeout(REQUEST_TIMEOUT, self.send(method, path, body))
            .await
            .map_err(|_| Error::Unreachable)??;
        if status.is_success() {
            return serde_json::from_slice(&bytes).map_err(Error::from);
        }
        let error = serde_json::from_slice::<ErrorBody>(&bytes).ok();
        let message = error
            .as_ref()
            .map(|body| body.error.clone())
            .unwrap_or_else(|| status.to_string());
        Err(match (status, message.as_str()) {
            (StatusCode::UNAUTHORIZED, _) => Error::NotPaired,
            (StatusCode::CONFLICT, "already_received") => Error::AlreadyReceived,
            (StatusCode::CONFLICT, "offset_mismatch") => Error::OffsetMismatch {
                received_bytes: error.and_then(|body| body.received_bytes).unwrap_or(0),
            },
            _ => Error::Http {
                status: status.as_u16(),
                message,
            },
        })
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<Bytes>,
    ) -> Result<(StatusCode, Bytes), Error> {
        let stream = self.connect().await?;
        let (mut sender, connection) =
            hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream))
                .await
                .map_err(|error| Error::Protocol(error.to_string()))?;
        let driver = tokio::spawn(async move {
            let _ = connection.await;
        });

        let has_body = body.is_some();
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(hyper::header::HOST, "mirna.local");
        if has_body {
            request = request.header(
                hyper::header::CONTENT_TYPE,
                if path.ends_with("/audio") || path.contains("/audio?") {
                    "application/octet-stream"
                } else {
                    "application/json"
                },
            );
        }
        let request = request
            .body(Full::new(body.unwrap_or_default()))
            .map_err(|error| Error::Protocol(error.to_string()))?;

        let response = sender
            .send_request(request)
            .await
            .map_err(|_| Error::Unreachable)?;
        let status = response.status();
        let bytes = response
            .into_body()
            .collect()
            .await
            .map_err(|_| Error::Unreachable)?
            .to_bytes();
        driver.abort();
        Ok((status, bytes))
    }

    async fn connect(&self) -> Result<TlsStream<TcpStream>, Error> {
        let mut hosts = Vec::with_capacity(self.target.hosts.len() + 1);
        if let Some(host) = self.working_host() {
            hosts.push(host);
        }
        for host in &self.target.hosts {
            if !hosts.contains(host) {
                hosts.push(host.clone());
            }
        }

        let mut saw_other_mac = false;
        for host in hosts {
            let tcp = match tokio::time::timeout(
                CONNECT_TIMEOUT,
                TcpStream::connect((host.as_str(), self.target.port)),
            )
            .await
            {
                Ok(Ok(tcp)) => tcp,
                _ => continue,
            };
            let _ = tcp.set_nodelay(true);
            match tokio::time::timeout(
                HANDSHAKE_TIMEOUT,
                self.connector.connect(crate::tls::server_name(), tcp),
            )
            .await
            {
                Ok(Ok(stream)) => {
                    if let Ok(mut working) = self.working_host.lock() {
                        *working = Some(host);
                    }
                    return Ok(stream);
                }
                Ok(Err(error)) if crate::tls::is_pin_mismatch(&error) => {
                    tracing::debug!(%host, "a different Mac answered");
                    saw_other_mac = true;
                }
                Ok(Err(error)) => {
                    tracing::debug!(%host, %error, "tls handshake failed");
                }
                Err(_) => {}
            }
        }
        Err(if saw_other_mac {
            Error::MacMismatch
        } else {
            Error::Unreachable
        })
    }
}
