// Serves the app's pages from the nightly site instead of the bundled files.
// Files are fetched on first use and kept on disk under the nightly build they came from,
// so a build only downloads once and still works offline after that.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const SITE: &str = "https://nightly.playeaw.com";
const CURRENT_FILE: &str = "current.txt";
const PREVIOUS_FILE: &str = "previous.txt";
const SWITCH_MARKER: &str = "api/channel";
const NOT_FOR_THE_APP: [&str; 4] = ["sw.js", "game.tar.gz", "game.tar", "build.json"];

pub struct Nightly {
    site: String,
    root: PathBuf,
    build: Mutex<Option<String>>,
}

impl Nightly {
    pub fn new(root: PathBuf) -> Nightly {
        let site = std::env::var("SWR_NIGHTLY")
            .ok()
            .filter(|url| !url.is_empty())
            .unwrap_or_else(|| SITE.into());
        Nightly {
            site: site.trim_end_matches('/').into(),
            root,
            build: Mutex::new(None),
        }
    }

    pub fn site(&self) -> &str {
        &self.site
    }

    pub fn build(&self) -> Option<String> {
        self.build.lock().unwrap().clone()
    }

    fn agent(timeout_seconds: u64) -> ureq::Agent {
        ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(timeout_seconds))
            .build()
    }

    fn fetch(&self, relative: &str, timeout_seconds: u64) -> Result<Vec<u8>, String> {
        let url = format!("{}/{}", self.site, relative);
        let response = Self::agent(timeout_seconds)
            .get(&url)
            .set("Cache-Control", "no-cache")
            .call()
            .map_err(|error| error.to_string())?;
        let mut body = vec![];
        std::io::Read::read_to_end(&mut response.into_reader(), &mut body)
            .map_err(|error| error.to_string())?;
        Ok(body)
    }

    fn remembered(&self, name: &str) -> Option<String> {
        std::fs::read_to_string(self.root.join(name))
            .ok()
            .map(|text| text.trim().to_string())
            .filter(|build| is_build_name(build))
    }

    fn remember(&self, name: &str, build: &str) {
        let _ = std::fs::create_dir_all(&self.root);
        let _ = std::fs::write(self.root.join(name), build);
    }

    /// Asks the nightly site which build it serves. Called when a page loads, so each page
    /// load runs one build; without a connection the last build seen is kept.
    pub fn refresh(&self) -> Option<String> {
        let latest = self
            .fetch("build.json", 4)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|info| info.get("build")?.as_str().map(String::from))
            .filter(|build| is_build_name(build));
        let mut current = self.build.lock().unwrap();
        match latest {
            Some(build) => {
                if current.as_deref() != Some(build.as_str()) {
                    let before = current.clone().or_else(|| self.remembered(CURRENT_FILE));
                    if let Some(before) = before.filter(|before| *before != build) {
                        self.remember(PREVIOUS_FILE, &before);
                    }
                    self.remember(CURRENT_FILE, &build);
                    *current = Some(build);
                    self.prune(current.as_deref());
                }
            }
            None => {
                if current.is_none() {
                    *current = self.remembered(CURRENT_FILE);
                }
            }
        }
        current.clone()
    }

    fn prune(&self, current: Option<&str>) {
        let previous = self.remembered(PREVIOUS_FILE);
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let kept = Some(name.as_str()) == current || Some(&name) == previous.as_ref();
            if entry.path().is_dir() && is_build_name(&name) && !kept {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }

    /// The nightly copy of a page file, or None to fall back to the bundled one.
    pub fn file(&self, relative: &str) -> Option<Vec<u8>> {
        if !for_the_app(relative) || !plain_relative(relative) {
            return None;
        }
        let build = self.build().or_else(|| self.refresh())?;
        let cached = self.root.join(&build).join(relative);
        if let Ok(bytes) = std::fs::read(&cached) {
            return Some(bytes);
        }
        let bytes = self.fetch(relative, 30).ok()?;
        store(&cached, &bytes);
        Some(bytes)
    }

    /// Whether the nightly build can switch the app back to stable: a nightly made before
    /// the switch existed would leave the app stuck on nightly.
    pub fn can_switch_back(&self) -> Result<(), String> {
        let script = self
            .fetch("js/appupdate.js", 10)
            .map_err(|error| format!("Could not reach {}: {error}", self.site))?;
        if String::from_utf8_lossy(&script).contains(SWITCH_MARKER) {
            Ok(())
        } else {
            Err("The nightly build has no switch back to stable yet, so it is not offered.".into())
        }
    }
}

/// A path inside a folder: only plain names, never a root, a drive, `..` or a `:` stream,
/// since joining an absolute path would replace the folder it is joined to.
pub fn plain_relative(relative: &str) -> bool {
    !relative.is_empty()
        && !relative.contains([':', '\\', '\0'])
        && std::path::Path::new(relative)
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}

fn is_build_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn for_the_app(relative: &str) -> bool {
    let lower = relative.to_lowercase();
    !NOT_FOR_THE_APP.contains(&lower.as_str()) && !lower.starts_with("test/")
}

fn store(path: &Path, bytes: &[u8]) {
    let Some(folder) = path.parent() else {
        return;
    };
    if std::fs::create_dir_all(folder).is_err() {
        return;
    }
    let partial = path
        .with_extension(format!("{:?}.part", std::thread::current().id()).replace(['(', ')'], ""));
    if std::fs::write(&partial, bytes).is_ok() && std::fs::rename(&partial, path).is_err() {
        let _ = std::fs::remove_file(&partial);
    }
}
