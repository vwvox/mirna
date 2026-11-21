#[cfg(all(target_os = "macos", target_arch = "aarch64", not(soniqo_disabled)))]
mod macos;
#[cfg(all(target_os = "macos", target_arch = "aarch64", not(soniqo_disabled)))]
pub(crate) use macos::*;

#[cfg(any(
    not(all(target_os = "macos", target_arch = "aarch64")),
    soniqo_disabled
))]
mod unsupported;
#[cfg(any(
    not(all(target_os = "macos", target_arch = "aarch64")),
    soniqo_disabled
))]
pub(crate) use unsupported::*;
