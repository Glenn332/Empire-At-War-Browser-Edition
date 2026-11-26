use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)]
pub struct Settings {
    pub game: Option<String>,
    pub sources: Vec<String>,
    pub hidden: Vec<String>,
    pub uncapped: bool,
    pub nightly: bool,
}

/// Where the app keeps its settings and caches: the per-user application data folder of
/// each system (the same folder Tauri itself uses for this identifier).
#[cfg(desktop)]
pub fn data_dir() -> PathBuf {
    user_data_base()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.playeaw.browseredition")
}

/// Android's private files folder of the app, which only the app itself can reach.
#[cfg(target_os = "android")]
pub fn data_dir() -> PathBuf {
    PathBuf::from("/data/data")
        .join(android_package())
        .join("files")
}

/// The folder the player copies the game into on Android: the app's own folder in shared
/// storage, Android/data/<package>/files, which a computer reaches over USB. The app's
/// activity asks Android for it at start, which makes the folder.
#[cfg(target_os = "android")]
pub fn player_folder() -> PathBuf {
    PathBuf::from("/storage/emulated/0/Android/data")
        .join(android_package())
        .join("files")
}

/// The package this process runs as: Android names each app process after its package.
#[cfg(target_os = "android")]
fn android_package() -> String {
    std::fs::read("/proc/self/cmdline")
        .ok()
        .and_then(|line| {
            let name = line.split(|&byte| byte == 0).next()?;
            let name = String::from_utf8_lossy(name);
            let package = name.split(':').next()?.trim().to_string();
            (!package.is_empty()).then_some(package)
        })
        .unwrap_or_else(|| "com.playeaw.browseredition".into())
}

/// iOS keeps everything inside the app's container: settings in Library, and the game in
/// Documents, which the Files app shows when the app shares its documents.
#[cfg(target_os = "ios")]
pub fn data_dir() -> PathBuf {
    ios_container().join("Library").join("Application Support")
}

#[cfg(target_os = "ios")]
pub fn player_folder() -> PathBuf {
    ios_container().join("Documents")
}

#[cfg(target_os = "ios")]
fn ios_container() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

/// The game a phone or tablet player copied into the app's folder: the folder itself, or
/// one folder inside it (the whole "Star Wars Empire at War" folder copied as it is).
#[cfg(mobile)]
pub fn copied_game() -> Option<PathBuf> {
    let folder = player_folder();
    if is_game(&folder) {
        return Some(folder);
    }
    let mut inside: Vec<PathBuf> = std::fs::read_dir(&folder)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| is_game(path))
        .collect();
    inside.sort();
    crate::vfs::most_complete(inside, |path| path)
}

#[cfg(windows)]
fn user_data_base() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn user_data_base() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
    })
}

#[cfg(target_os = "linux")]
fn user_data_base() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|folder| folder.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
}

impl Settings {
    pub fn load() -> Settings {
        std::fs::read_to_string(data_dir().join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
    pub fn save(&self) {
        let _ = std::fs::create_dir_all(data_dir());
        let _ = std::fs::write(
            data_dir().join("settings.json"),
            serde_json::to_vec_pretty(self).unwrap(),
        );
    }
}

pub fn same(a: &Path, b: &Path) -> bool {
    let n = |p: &Path| {
        p.to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    };
    n(a) == n(b)
}

pub const EXPANSION_DIRS: [&str; 2] = ["corruption", "EAWX"];
pub const GAME_EXES: [&str; 3] = ["StarWarsG.exe", "swfoc.exe", "sweaw.exe"];

pub fn expansion_dir(game: &Path) -> Option<PathBuf> {
    EXPANSION_DIRS.iter().find_map(|name| child_dir(game, name))
}

pub fn is_game(p: &Path) -> bool {
    child_dir(p, "GameData").is_some()
}

pub fn child_dir(p: &Path, name: &str) -> Option<PathBuf> {
    std::fs::read_dir(p)
        .ok()?
        .flatten()
        .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name) && e.path().is_dir())
        .map(|e| e.path())
}

#[derive(Clone, Serialize)]
pub struct Source {
    pub path: PathBuf,
    pub kind: &'static str,
}

pub fn found_sources(game: Option<&Path>) -> Vec<Source> {
    let mut out: Vec<Source> = crate::steam::workshop_roots()
        .into_iter()
        .map(|path| Source {
            path,
            kind: "workshop",
        })
        .collect();
    if let Some(m) = game
        .and_then(expansion_dir)
        .and_then(|c| child_dir(&c, "Mods"))
    {
        out.push(Source {
            path: m,
            kind: "game",
        });
    }
    out
}

pub struct Found {
    pub folder: PathBuf,
    pub workshop: Option<String>,
    pub version: String,
    pub source: PathBuf,
}

fn changed(p: &Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

pub fn mods_in(
    source: &Source,
    versions: &std::collections::HashMap<String, String>,
) -> Vec<Found> {
    let one = |folder: PathBuf| {
        let data = child_dir(&folder, "Data")?;
        let workshop = (source.kind == "workshop")
            .then(|| folder.file_name().map(|n| n.to_string_lossy().into_owned()))
            .flatten()
            .filter(|n| n.bytes().all(|b| b.is_ascii_digit()));
        let version = match workshop.as_ref().and_then(|id| versions.get(id)) {
            Some(v) => v.clone(),
            None => {
                let inner = std::fs::read_dir(&data)
                    .map(|l| l.flatten().map(|e| changed(&e.path())).max().unwrap_or(0))
                    .unwrap_or(0);
                [changed(&folder), changed(&data), inner]
                    .into_iter()
                    .max()
                    .unwrap_or(0)
                    .to_string()
            }
        };
        Some(Found {
            folder,
            workshop,
            version,
            source: source.path.clone(),
        })
    };
    if child_dir(&source.path, "Data").is_some() {
        return one(source.path.clone()).into_iter().collect();
    }
    let mut out: Vec<Found> = std::fs::read_dir(&source.path)
        .map(|l| {
            l.flatten()
                .filter(|e| e.path().is_dir())
                .filter_map(|e| one(e.path()))
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|f| {
        f.folder
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });
    out
}
