use std::path::PathBuf;

const GAME_ID: &str = "1421404887";

#[cfg(windows)]
pub fn game_folder() -> Option<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    for root in [
        "SOFTWARE\\WOW6432Node\\GOG.com\\Games",
        "SOFTWARE\\GOG.com\\Games",
    ] {
        let Ok(games) = hklm.open_subkey(root) else {
            continue;
        };
        let mut ids: Vec<String> = games.enum_keys().flatten().collect();
        ids.sort_by_key(|id| id != GAME_ID);
        for id in ids {
            let Ok(k) = games.open_subkey(&id) else {
                continue;
            };
            let name = k
                .get_value::<String, _>("GAMENAME")
                .unwrap_or_default()
                .to_lowercase();
            if id != GAME_ID && !name.contains("empire at war") {
                continue;
            }
            let Ok(path) = k.get_value::<String, _>("PATH") else {
                continue;
            };
            let path = PathBuf::from(path.trim_end_matches(['\\', '/']));
            if crate::setup::is_game(&path) {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(not(windows))]
pub fn game_folder() -> Option<PathBuf> {
    None
}
