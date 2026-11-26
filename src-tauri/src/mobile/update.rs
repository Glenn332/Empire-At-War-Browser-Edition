// Android and iOS builds update through their app stores, not the in-app updater: the page's
// update calls answer that there is nothing to install.
use tauri::AppHandle;

#[derive(Default)]
pub struct Updates;

impl Updates {
    pub fn check(&self, app: &AppHandle) -> serde_json::Value {
        let current = app.package_info().version.to_string();
        serde_json::json!({ "current": current, "available": false })
    }

    pub fn install(&'static self, _app: &AppHandle) -> Result<(), String> {
        Err("This build is updated by reinstalling it, not from inside the app.".into())
    }

    pub fn progress(&self) -> serde_json::Value {
        serde_json::json!({ "state": "", "got": 0, "total": 0 })
    }
}
