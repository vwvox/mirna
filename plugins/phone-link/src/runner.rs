//! Starts and stops the listener and its Bonjour record.
//!
//! The listener only runs while at least one phone is paired or a pairing
//! code is on screen, so a Mac that never pairs a phone opens no port and
//! announces nothing on the network.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use anlg_phone_link::server::PhoneLinkServer;
use anlg_phone_link::{DEFAULT_PORT, SERVICE_TYPE};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub(crate) struct Running {
    pub port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    mdns: Option<mdns_sd::ServiceDaemon>,
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(mdns) = self.mdns.take() {
            let _ = mdns.shutdown();
        }
    }
}

pub(crate) async fn start(server: &PhoneLinkServer) -> Result<Running, String> {
    let listener = match TcpListener::bind(SocketAddr::new(
        IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        DEFAULT_PORT,
    ))
    .await
    {
        Ok(listener) => listener,
        Err(error) => {
            tracing::warn!(%error, "phone link port busy, using another");
            TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0))
                .await
                .map_err(|error| format!("Could not open a port for the phone: {error}"))?
        }
    };
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let (shutdown, stop) = oneshot::channel::<()>();
    let serving = server.clone();
    tauri::async_runtime::spawn(async move {
        serving
            .serve(listener, async {
                let _ = stop.await;
            })
            .await;
    });

    let mdns = match advertise(server, port) {
        Ok(daemon) => Some(daemon),
        Err(error) => {
            // The phone still finds the Mac at the address in the QR code.
            tracing::warn!(%error, "could not announce Mirna on the local network");
            None
        }
    };

    Ok(Running {
        port,
        shutdown: Some(shutdown),
        mdns,
    })
}

fn advertise(server: &PhoneLinkServer, port: u16) -> Result<mdns_sd::ServiceDaemon, String> {
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|error| error.to_string())?;
    let mac_id = server.mac_id();
    let instance: String = format!("Mirna {}", &mac_id[..8.min(mac_id.len())]);
    let host = format!("mirna-{}.local.", &mac_id[..8.min(mac_id.len())]);
    let properties = [("id", mac_id.as_str()), ("v", "1")];
    let info = mdns_sd::ServiceInfo::new(SERVICE_TYPE, &instance, &host, "", port, &properties[..])
        .map_err(|error| error.to_string())?
        .enable_addr_auto();
    daemon.register(info).map_err(|error| error.to_string())?;
    Ok(daemon)
}

/// This Mac's IPv4 addresses on local networks, most likely first.
pub(crate) fn local_addresses() -> Vec<String> {
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    let mut addresses: Vec<(u8, String)> = interfaces
        .into_iter()
        .filter(|interface| !interface.is_loopback() && !interface.is_link_local())
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(ip) => Some((rank(&interface.name, ip), ip.to_string())),
            IpAddr::V6(_) => None,
        })
        .filter(|(rank, _)| *rank < 9)
        .collect();
    addresses.sort();
    addresses.dedup_by(|a, b| a.1 == b.1);
    addresses.into_iter().map(|(_, ip)| ip).take(4).collect()
}

fn rank(interface: &str, ip: Ipv4Addr) -> u8 {
    // VPNs, bridges for virtual machines and AirDrop links aren't reachable
    // from the phone.
    if interface.starts_with("utun")
        || interface.starts_with("bridge")
        || interface.starts_with("awdl")
        || interface.starts_with("llw")
        || interface.starts_with("vmnet")
    {
        return 9;
    }
    let wifi_or_ethernet = interface.starts_with("en");
    match (ip.is_private(), wifi_or_ethernet) {
        (true, true) => 0,
        (true, false) => 1,
        (false, true) => 2,
        (false, false) => 3,
    }
}

/// How long a pairing code stays valid.
pub(crate) const PAIRING_TTL: Duration = Duration::from_secs(5 * 60);
