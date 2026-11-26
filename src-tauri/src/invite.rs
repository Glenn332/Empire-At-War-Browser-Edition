// Invite links that open the app: playeaw://join/<code>?lobby=<lobby url>&kind=lan
// The site offers one of these next to its own invite link; Windows hands it to the app,
// which opens the multiplayer lobby and joins the game.

pub const SCHEME: &str = "playeaw";

/// The play.html query that joins the game an invite link names.
pub fn page_query(link: &str) -> Option<String> {
    let rest = link
        .get(..SCHEME.len() + 3)
        .filter(|head| head.eq_ignore_ascii_case(&format!("{SCHEME}://")))
        .map(|_| &link[SCHEME.len() + 3..])?;
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let code = path
        .trim_matches('/')
        .strip_prefix("join/")?
        .trim_end_matches('/');
    if !is_join_code(code) {
        return None;
    }
    let mut lobby = None;
    let mut lan = false;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let value = percent_encoding::percent_decode_str(value).decode_utf8_lossy();
        match key {
            "lobby" if is_known_lobby(&value) => lobby = Some(value.into_owned()),
            "kind" => lan = value == "lan",
            _ => {}
        }
    }
    let mut out = format!(
        "{}&join={code}",
        if lan {
            "multiplayer=lan"
        } else {
            "multiplayer"
        }
    );
    if let Some(lobby) = lobby {
        let encoded =
            percent_encoding::utf8_percent_encode(&lobby, percent_encoding::NON_ALPHANUMERIC);
        out.push_str(&format!("&lobby={encoded}"));
    }
    Some(out)
}

pub fn find_link(args: &[String]) -> Option<String> {
    args.iter()
        .find(|arg| {
            arg.get(..SCHEME.len() + 3)
                .is_some_and(|head| head.eq_ignore_ascii_case(&format!("{SCHEME}://")))
        })
        .cloned()
}

fn is_join_code(code: &str) -> bool {
    (6..=32).contains(&code.len())
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

const NIGHTLY_LOBBY: &str = "sw-revival-lobby.glenncool.workers.dev";

/// A link only points the app at the project's own lobby services (the live one and the
/// nightly test one), so a link from anywhere cannot send the app to someone else's server.
fn is_known_lobby(url: &str) -> bool {
    let Some(host) = url.strip_prefix("https://") else {
        return false;
    };
    let host = host.trim_end_matches('/');
    !host.contains(['/', '\\', '@', ':', '?', '#', '%'])
        && !host.chars().any(char::is_whitespace)
        && (host == "playeaw.com" || host.ends_with(".playeaw.com") || host == NIGHTLY_LOBBY)
}

/// Points playeaw:// links at this copy of the app. A release build always takes them over;
/// a development build only when no working app has them, so it does not steal them from
/// the installed app.
#[cfg(windows)]
pub fn register() {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe = exe.to_string_lossy().into_owned();
    let command = format!("\"{exe}\" \"%1\"");
    let classes = RegKey::predef(HKEY_CURRENT_USER);
    let key_path = format!(r"Software\Classes\{SCHEME}");
    let open_path = format!(r"{key_path}\shell\open\command");
    let registered: Option<String> = classes
        .open_subkey(&open_path)
        .and_then(|key| key.get_value(""))
        .ok();
    if registered.as_deref() == Some(command.as_str()) {
        return;
    }
    let registered_works = registered.as_deref().is_some_and(|line| {
        line.trim_start_matches('"')
            .split('"')
            .next()
            .is_some_and(|path| std::path::Path::new(path).is_file())
    });
    if cfg!(debug_assertions) && registered_works {
        return;
    }
    let write = || -> std::io::Result<()> {
        let (root, _) = classes.create_subkey(&key_path)?;
        root.set_value("", &"URL:Empire at War Browser Edition")?;
        root.set_value("URL Protocol", &"")?;
        let (icon, _) = classes.create_subkey(format!(r"{key_path}\DefaultIcon"))?;
        icon.set_value("", &format!("\"{exe}\",0"))?;
        let (open, _) = classes.create_subkey(&open_path)?;
        open.set_value("", &command)?;
        Ok(())
    };
    if let Err(error) = write() {
        eprintln!("could not register {SCHEME}:// links: {error}");
    }
}

#[cfg(not(windows))]
pub fn register() {}
