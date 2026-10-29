use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)]
pub struct Settings {
    pub game: Option<String>,
    pub sources: Vec<String>,
    pub hidden: Vec<String>,
    pub uncapped: bool,
}

pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("com.swrevival.app")
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
        .and_then(|g| child_dir(g, "corruption"))
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
