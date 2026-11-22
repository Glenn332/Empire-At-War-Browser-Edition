use std::path::{Path, PathBuf};
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

fn show_in_folder(path: &Path) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn();
    }
    #[cfg(not(windows))]
    let _ = path;
}

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
