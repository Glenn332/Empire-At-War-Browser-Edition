use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates {
    found: Mutex<Option<Update>>,
    state: Mutex<String>,
    got: Mutex<(u64, u64)>,
}

impl Updates {
    pub fn check(&self, app: &AppHandle) -> serde_json::Value {
        let current = app.package_info().version.to_string();
        let found = tauri::async_runtime::block_on(async {
            let updater = app.updater().map_err(|e| e.to_string())?;
            updater.check().await.map_err(|e| e.to_string())
        });
        match found {
            Ok(Some(u)) => {
                let out = serde_json::json!({ "current": current, "available": true, "version": u.version, "notes": u.body, "date": u.date.map(|d| d.to_string()) });
                *self.found.lock().unwrap() = Some(u);
                out
            }
            Ok(None) => serde_json::json!({ "current": current, "available": false }),
            Err(e) => serde_json::json!({ "current": current, "available": false, "error": e }),
        }
    }

    pub fn install(&'static self, app: &AppHandle) -> Result<(), String> {
        let Some(u) = self.found.lock().unwrap().take() else { return Err("No update found to install: check again.".into()) };
        *self.state.lock().unwrap() = "downloading".into();
        let app = app.clone();
        std::thread::spawn(move || {
            let done = tauri::async_runtime::block_on(u.download_and_install(
                |chunk, total| {
                    let mut g = self.got.lock().unwrap();
                    g.0 += chunk as u64;
                    g.1 = total.unwrap_or(0);
                },
                || *self.state.lock().unwrap() = "installing".into(),
            ));
            match done {
                Ok(()) => app.restart(),
                Err(e) => *self.state.lock().unwrap() = format!("failed: {e}"),
            }
        });
        Ok(())
    }

    pub fn progress(&self) -> serde_json::Value {
        let (got, total) = *self.got.lock().unwrap();
        serde_json::json!({ "state": *self.state.lock().unwrap(), "got": got, "total": total })
    }
}
