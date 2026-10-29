use std::path::{Path, PathBuf};

const APP: &str = "32470";
const FOLDER: &str = "Star Wars Empire at War";

#[cfg(windows)]
fn steam_folders() -> Vec<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let mut out = vec![];
    if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
        if let Ok(p) = k.get_value::<String, _>("SteamPath") {
            out.push(PathBuf::from(p));
        }
    }
    for key in [
        "SOFTWARE\\WOW6432Node\\Valve\\Steam",
        "SOFTWARE\\Valve\\Steam",
    ] {
        if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(key) {
            if let Ok(p) = k.get_value::<String, _>("InstallPath") {
                out.push(PathBuf::from(p));
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn steam_folders() -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    [".steam/steam", ".local/share/Steam"]
        .iter()
        .map(|p| Path::new(&home).join(p))
        .collect()
}

pub fn libraries() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = vec![];
    let mut add = |p: PathBuf| {
        if !out
            .iter()
            .any(|o| o.to_string_lossy().to_lowercase() == p.to_string_lossy().to_lowercase())
        {
            out.push(p);
        }
    };
    for steam in steam_folders() {
        add(steam.clone());
        let Ok(vdf) = std::fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf"))
        else {
            continue;
        };
        let rx = regex::Regex::new(r#""path"\s+"((?:[^"\\]|\\.)*)""#).unwrap();
        for c in rx.captures_iter(&vdf) {
            add(PathBuf::from(c[1].replace("\\\\", "\\")));
        }
    }
    out
}

pub fn game_folder() -> Option<PathBuf> {
    libraries()
        .into_iter()
        .map(|l| l.join("steamapps").join("common").join(FOLDER))
        .find(|p| p.join("GameData").is_dir())
}

pub fn workshop_item(id: &str) -> Option<PathBuf> {
    libraries()
        .into_iter()
        .map(|l| {
            l.join("steamapps")
                .join("workshop")
                .join("content")
                .join(APP)
                .join(id)
        })
        .find(|p| p.is_dir())
}

pub fn mods(args: &[String], game: &Path) -> Vec<PathBuf> {
    let prefixed = |a: &str, p: &str| {
        a.get(..p.len())
            .filter(|h| h.eq_ignore_ascii_case(p))
            .map(|_| a[p.len()..].trim().to_string())
    };
    let mut asked: Vec<String> = vec![];
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--mod" {
            asked.extend(it.next().cloned());
        } else if prefixed(a, "STEAMMOD=").is_some() || prefixed(a, "MODPATH=").is_some() {
            asked.push(a.clone());
        }
    }
    asked.extend(
        std::env::var("SWR_MOD")
            .unwrap_or_default()
            .split(';')
            .filter(|s| !s.is_empty())
            .map(String::from),
    );
    let mut out = vec![];
    for a in asked {
        let found = if let Some(id) = prefixed(&a, "STEAMMOD=") {
            workshop_item(&id)
        } else if let Some(rel) = prefixed(&a, "MODPATH=") {
            Some(game.join("corruption").join(rel))
        } else {
            Some(PathBuf::from(&a))
        };
        match found.filter(|p| p.is_dir()) {
            Some(p) => out.push(p),
            None => eprintln!("mod not found: {a}"),
        }
    }
    out
}

pub fn info_name(folder: &Path) -> Option<String> {
    let f = std::fs::read_dir(folder).ok()?.flatten().find(|e| {
        e.file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case("modinfo.json")
    })?;
    let text = std::fs::read_to_string(f.path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    [&v["name"], &v["steamdata"]["title"]]
        .iter()
        .filter_map(|n| n.as_str())
        .map(|n| n.trim().to_string())
        .find(|n| !n.is_empty())
}

pub fn workshop_titles(ids: &[String], cache: &Path) -> std::collections::HashMap<String, String> {
    let mut known: std::collections::HashMap<String, String> = std::fs::read_to_string(cache)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let ask: Vec<&String> = ids.iter().filter(|id| !known.contains_key(*id)).collect();
    if !ask.is_empty() {
        let mut form = vec![("itemcount".to_string(), ask.len().to_string())];
        form.extend(
            ask.iter()
                .enumerate()
                .map(|(i, id)| (format!("publishedfileids[{i}]"), id.to_string())),
        );
        let pairs: Vec<(&str, &str)> = form.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let reply = ureq::post(
            "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
        )
        .timeout(std::time::Duration::from_secs(8))
        .send_form(&pairs)
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok());
        if let Some(list) = reply
            .as_ref()
            .and_then(|v| v["response"]["publishedfiledetails"].as_array())
        {
            for d in list {
                if let (Some(id), Some(t)) = (d["publishedfileid"].as_str(), d["title"].as_str()) {
                    if !t.trim().is_empty() {
                        known.insert(id.to_string(), t.trim().to_string());
                    }
                }
            }
            if let Some(dir) = cache.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(cache, serde_json::to_vec(&known).unwrap());
        }
    }
    known
}

pub fn workshop_versions() -> std::collections::HashMap<String, String> {
    let item = regex::Regex::new(r#""(\d+)"\s*\{[^}]*?"manifest"\s*"(\d+)""#).unwrap();
    let mut out = std::collections::HashMap::new();
    for l in libraries() {
        let acf = std::fs::read_to_string(
            l.join("steamapps")
                .join("workshop")
                .join(format!("appworkshop_{APP}.acf")),
        )
        .unwrap_or_default();
        for c in item.captures_iter(&acf) {
            out.entry(c[1].to_string())
                .or_insert_with(|| c[2].to_string());
        }
    }
    out
}

pub fn workshop_roots() -> Vec<PathBuf> {
    libraries()
        .into_iter()
        .map(|l| {
            l.join("steamapps")
                .join("workshop")
                .join("content")
                .join(APP)
        })
        .filter(|p| p.is_dir())
        .collect()
}
