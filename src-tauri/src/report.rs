use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
fn read_stream(stream: &windows::Win32::System::Com::IStream) -> Option<Vec<u8>> {
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
    unsafe {
        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME).ok()?;
        stream.Seek(0, STREAM_SEEK_SET, None).ok()?;
        let mut bytes = vec![0u8; stat.cbSize as usize];
        let mut filled = 0usize;
        while filled < bytes.len() {
            let mut read = 0u32;
            let left = (bytes.len() - filled) as u32;
            if stream
                .Read(bytes[filled..].as_mut_ptr().cast(), left, Some(&mut read))
                .is_err()
                || read == 0
            {
                break;
            }
            filled += read as usize;
        }
        bytes.truncate(filled);
        Some(bytes)
    }
}

#[cfg(windows)]
pub fn screenshot(app: &AppHandle) -> Option<Vec<u8>> {
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    let window = app.get_webview_window("main")?;
    let (done, result) = mpsc::channel::<Option<Vec<u8>>>();
    let started = window.with_webview(move |platform| unsafe {
        let failed = done.clone();
        let capture = || -> windows::core::Result<()> {
            let webview = platform.controller().CoreWebView2()?;
            let stream = windows::Win32::UI::Shell::SHCreateMemStream(None)
                .ok_or_else(windows::core::Error::empty)?;
            let target = stream.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |outcome| {
                let _ = done.send(outcome.ok().and_then(|_| read_stream(&target)));
                Ok(())
            }));
            webview.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &handler,
            )
        };
        if capture().is_err() {
            let _ = failed.send(None);
        }
    });
    started.ok()?;
    result.recv_timeout(Duration::from_secs(10)).ok().flatten()
}

#[cfg(not(windows))]
pub fn screenshot(_app: &AppHandle) -> Option<Vec<u8>> {
    None
}

#[cfg(desktop)]
fn downloads_folder() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join("Downloads"))
        .filter(|folder| folder.is_dir())
}

fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(['-', '.']);
    if trimmed.is_empty() {
        "bug-report.zip".into()
    } else if trimmed.to_ascii_lowercase().ends_with(".zip") {
        trimmed.into()
    } else {
        format!("{trimmed}.zip")
    }
}

/// A phone has no save dialog: the report goes in the reports folder inside the app's own
/// files, where the player copies the game to as well.
#[cfg(mobile)]
pub fn save(_app: &AppHandle, name: &str, bytes: &[u8]) -> Result<Option<PathBuf>, String> {
    let folder = crate::setup::player_folder().join("reports");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(safe_file_name(name));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path))
}

#[cfg(desktop)]
fn show_in_folder(path: &std::path::Path) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn();
    }
    #[cfg(not(windows))]
    let _ = path;
}

#[cfg(desktop)]
pub fn save(app: &AppHandle, name: &str, bytes: &[u8]) -> Result<Option<PathBuf>, String> {
    let mut dialog = rfd::FileDialog::new()
        .set_title("Save bug report")
        .set_file_name(safe_file_name(name))
        .add_filter("Zip archive", &["zip"]);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    if let Some(folder) = downloads_folder() {
        dialog = dialog.set_directory(folder);
    }
    let Some(path) = dialog.save_file() else {
        return Ok(None);
    };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    show_in_folder(&path);
    Ok(Some(path))
}

#[cfg(windows)]
fn power_mode_name(guid: &str) -> String {
    match guid.to_ascii_lowercase().as_str() {
        "ded574b5-45a0-4f42-8737-46345c09c238" => "best performance".into(),
        "961cc777-2547-4f9d-8174-7d86181b8a7a" => "best power efficiency".into(),
        "3af9b8d9-7c97-431d-ad78-34a8bfea439f" => "better performance".into(),
        "" | "00000000-0000-0000-0000-000000000000" => "balanced".into(),
        other => other.into(),
    }
}

#[cfg(windows)]
fn gpu_preference_name(setting: &str) -> &'static str {
    match setting
        .split(';')
        .find_map(|part| part.trim().strip_prefix("GpuPreference="))
    {
        Some("1") => "power saving",
        Some("2") => "high performance",
        Some("0") => "let Windows decide",
        _ => "not set",
    }
}

#[cfg(windows)]
pub fn power() -> serde_json::Value {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let mut status = SYSTEM_POWER_STATUS::default();
    let read = unsafe { GetSystemPowerStatus(&mut status) }.is_ok();
    let schemes = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes")
        .ok();
    let overlay = |name: &str| {
        schemes
            .as_ref()
            .map(|key| power_mode_name(&key.get_value::<String, _>(name).unwrap_or_default()))
    };
    let preferences: Vec<serde_json::Value> = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\DirectX\UserGpuPreferences")
        .map(|key| {
            key.enum_values()
                .flatten()
                .filter_map(|(name, _)| {
                    let program = std::path::Path::new(&name)
                        .file_name()
                        .map(|f| f.to_string_lossy().into_owned())
                        .unwrap_or_else(|| name.clone());
                    let lower = program.to_ascii_lowercase();
                    let relevant = name == "DirectXUserGlobalSettings"
                        || lower.contains("msedgewebview2")
                        || lower.contains("empire")
                        || lower.contains("chrome")
                        || lower.contains("msedge")
                        || lower.contains("firefox");
                    relevant.then(|| {
                        let setting: String = key.get_value(&name).unwrap_or_default();
                        serde_json::json!({ "program": program, "gpu": gpu_preference_name(&setting) })
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    serde_json::json!({
        "pluggedIn": read.then_some(status.ACLineStatus == 1),
        "hasBattery": read.then_some(status.BatteryFlag != 128 && status.BatteryFlag != 255),
        "batteryPercent": (read && status.BatteryLifePercent <= 100).then_some(status.BatteryLifePercent),
        "batterySaver": read.then_some(status.SystemStatusFlag == 1),
        "powerModePluggedIn": overlay("ActiveOverlayAcPowerScheme"),
        "powerModeOnBattery": overlay("ActiveOverlayDcPowerScheme"),
        "gpuPreferences": preferences
    })
}

#[cfg(not(windows))]
pub fn power() -> serde_json::Value {
    serde_json::Value::Null
}
