mod audio;
#[cfg(windows)]
mod cursorclip;
#[cfg(desktop)]
mod discord;
#[cfg(mobile)]
#[path = "mobile/discord.rs"]
mod discord;
mod fonts;
mod gog;
mod invite;
mod nightly;
mod procstats;
mod report;
mod setup;
mod steam;
#[cfg(desktop)]
mod update;
#[cfg(mobile)]
#[path = "mobile/update.rs"]
mod update;
mod vfs;

use fonts::NativeFonts;
use setup::{Settings, Source};
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

#[cfg(desktop)]
static CURSOR_GRAB: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static TASKBAR_FULL: AtomicBool = AtomicBool::new(false);
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use vfs::{Game, View};

const TAURI_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --force_high_performance_gpu";
const UNCAPPED: &str = "--disable-frame-rate-limit --disable-gpu-vsync";
// the page needs inline and eval'd script (its own pages, Lua glue); it may reach any https or wss lobby
// (custom ones too) and GitHub's release feed, but it can't be framed or post forms elsewhere
const CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://storage.ko-fi.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: blob: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' data: blob: https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; frame-src 'self' blob: https://ko-fi.com; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'";

struct Opened {
    game: Arc<View>,
    fonts: NativeFonts,
}

struct Server {
    mods: Vec<PathBuf>,
    public: Option<PathBuf>,
    env_game: Option<PathBuf>,
    fallback: Option<PathBuf>,
    nightly: nightly::Nightly,
    state: RwLock<State>,
    // folders the player chose in the native folder dialog: the only ones the page may add as sources
    picked: Mutex<Vec<PathBuf>>,
}

struct State {
    settings: Settings,
    dir: Option<PathBuf>,
    how: &'static str,
    steam: Option<PathBuf>,
    foc: Option<Arc<Opened>>,
    eaw: Option<Option<Arc<Opened>>>,
    sources: Vec<Source>,
    local: Vec<String>,
}

impl State {
    /// The expansion's game opened with the files it needs to start.
    fn game_ready(&self) -> bool {
        self.foc.as_ref().is_some_and(|opened| {
            opened
                .game
                .resolve("Data/XML/GameObjectFiles.xml")
                .is_some()
        })
    }
}

fn canonical(p: &Path) -> Option<String> {
    let c = std::fs::canonicalize(p)
        .ok()?
        .to_string_lossy()
        .to_lowercase();
    Some(c.strip_prefix(r"\\?\").map(String::from).unwrap_or(c))
}

fn workshop_names(ids: &[String]) -> serde_json::Map<String, serde_json::Value> {
    let mut names = serde_json::Map::new();
    for id in ids {
        if let Some(n) = steam::workshop_item(id).and_then(|f| steam::info_name(&f)) {
            names.insert(id.clone(), n.into());
        }
    }
    let ask: Vec<String> = ids
        .iter()
        .filter(|id| !names.contains_key(*id))
        .cloned()
        .collect();
    if !ask.is_empty() {
        for (id, t) in steam::workshop_titles(&ask, &setup::data_dir().join("workshop-titles.json"))
        {
            if ask.contains(&id) {
                names.insert(id, t.into());
            }
        }
    }
    names
}

fn ranged(file: &Path, range: Option<&str>) -> Response<Vec<u8>> {
    let Ok(f) = std::fs::File::open(file) else {
        return text(404, "not found");
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let want = match vfs::range_of(range, len) {
        Some(Err(())) => {
            return send(
                416,
                vec![],
                "text/plain; charset=utf-8",
                &[("Content-Range", &format!("bytes */{len}"))],
            );
        }
        Some(Ok(r)) => Some(r),
        None => None,
    };
    let (a, n) = match want {
        Some((a, b)) => (a, b - a + 1),
        None => (0, len),
    };
    let mut buf = vec![0; n as usize];
    if vfs::read_at(&f, &mut buf, a).is_err() {
        return text(500, "unreadable");
    }
    let kind = mime(&file.to_string_lossy());
    match want {
        Some((a, b)) => send(
            206,
            buf,
            kind,
            &[
                ("Content-Range", &format!("bytes {a}-{b}/{len}")),
                ("Accept-Ranges", "bytes"),
            ],
        ),
        None => send(200, buf, kind, &[("Accept-Ranges", "bytes")]),
    }
}

fn mime(p: &str) -> &'static str {
    match Path::new(p)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("xml") => "text/xml; charset=windows-1252",
        Some("txt" | "lua") => "text/plain; charset=windows-1252",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("gz") => "application/gzip",
        Some("wasm") => "application/wasm",
        Some("ico") => "image/x-icon",
        Some("webmanifest") => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

fn send(code: u16, body: Vec<u8>, kind: &str, extra: &[(&str, &str)]) -> Response<Vec<u8>> {
    let mut r = Response::builder()
        .status(code)
        .header("Content-Type", kind)
        .header("Cross-Origin-Opener-Policy", "same-origin")
        .header("Cross-Origin-Embedder-Policy", "require-corp")
        .header("Cross-Origin-Resource-Policy", "same-origin");
    for (k, v) in extra {
        r = r.header(*k, *v);
    }
    r.body(body).unwrap()
}

fn text(code: u16, s: &str) -> Response<Vec<u8>> {
    send(
        code,
        s.as_bytes().to_vec(),
        "text/plain; charset=utf-8",
        &[],
    )
}

fn json(v: &impl serde::Serialize) -> Response<Vec<u8>> {
    send(200, serde_json::to_vec(v).unwrap(), "application/json", &[])
}

fn query(uri: &tauri::http::Uri) -> Vec<(String, String)> {
    let q = uri.query().unwrap_or("");
    q.split('&')
        .filter(|s| !s.is_empty())
        .map(|kv| {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            let d = |s: &str| {
                percent_encoding::percent_decode_str(&s.replace('+', " "))
                    .decode_utf8_lossy()
                    .into_owned()
            };
            (d(k), d(v))
        })
        .collect()
}

/// The game folder the app finds by itself: Steam's, then GOG's, then the development copy,
/// but a copy missing fewer of its files wins (an old, emptied Steam copy loses to GOG's).
fn found_game(steam: Option<&Path>, fallback: Option<&Path>) -> Option<(PathBuf, &'static str)> {
    #[cfg(mobile)]
    let copied = setup::copied_game();
    #[cfg(desktop)]
    let copied: Option<PathBuf> = None;
    let found: Vec<(PathBuf, &'static str)> = [
        (steam.map(PathBuf::from), "steam"),
        (gog::game_folder(), "gog"),
        (copied, "copied"),
        (fallback.map(PathBuf::from), "dev"),
    ]
    .into_iter()
    .filter_map(|(path, how)| path.map(|path| (path, how)))
    .collect();
    vfs::most_complete(found, |(path, _)| path)
}

fn open(dir: &Path, mods: &[PathBuf], expansion: bool) -> Arc<Opened> {
    let t0 = std::time::Instant::now();
    let game = Game::open(dir, mods, 0, expansion);
    println!(
        "indexed {} {} files in {} ms from {}",
        game.index.len(),
        if expansion { "game" } else { "original game" },
        t0.elapsed().as_millis(),
        dir.display()
    );
    Arc::new(Opened {
        fonts: NativeFonts::new(game.clone()),
        game,
    })
}

impl Server {
    fn settle(&self, settings: Settings, was: Option<&State>) -> State {
        let steam = steam::game_folder();
        let chosen = settings
            .game
            .as_ref()
            .map(PathBuf::from)
            .filter(|p| setup::is_game(p));
        let (dir, how) = if let Some(e) = &self.env_game {
            (Some(e.clone()), "env")
        } else if let Some(c) = chosen {
            (Some(c), "chosen")
        } else if let Some((found, how)) = found_game(steam.as_deref(), self.fallback.as_deref()) {
            (Some(found), how)
        } else {
            (None, "none")
        };
        let mut sources: Vec<Source> = setup::found_sources(dir.as_deref())
            .into_iter()
            .filter(|s| {
                !settings
                    .hidden
                    .iter()
                    .any(|h| setup::same(&s.path, Path::new(h)))
            })
            .collect();
        for a in &settings.sources {
            if !sources.iter().any(|s| setup::same(&s.path, Path::new(a))) {
                sources.push(Source {
                    path: PathBuf::from(a),
                    kind: "added",
                });
            }
        }
        let local = sources
            .iter()
            .map(|s| s.path.clone())
            .chain(dir.iter().cloned())
            .filter_map(|p| canonical(&p))
            .collect();
        // the same folder keeps its opened game, unless that game could not start (files that
        // were still being copied in): then it is opened again
        if let Some(w) = was.filter(|w| w.dir.is_some() && w.dir == dir && w.game_ready()) {
            return State {
                settings,
                dir,
                how,
                steam,
                foc: w.foc.clone(),
                eaw: w.eaw.clone(),
                sources,
                local,
            };
        }
        let foc = dir.as_ref().map(|d| open(d, &self.mods, true));
        if foc.is_none() {
            println!("no game install found: serving the app alone");
        }
        State {
            settings,
            dir,
            how,
            steam,
            foc,
            eaw: None,
            sources,
            local,
        }
    }

    fn change(&self, f: impl FnOnce(&mut Settings)) {
        let mut st = self.state.write().unwrap();
        let mut settings = st.settings.clone();
        f(&mut settings);
        settings.save();
        let fresh = self.settle(settings, Some(&st));
        *st = fresh;
    }

    fn may_read(&self, p: &Path) -> bool {
        let st = self.state.read().unwrap();
        canonical(p).is_some_and(|c| {
            st.local.iter().any(|r| {
                c == *r
                    || c.strip_prefix(r.as_str())
                        .is_some_and(|rest| rest.starts_with(['\\', '/']))
            })
        })
    }

    fn game_for(&self, q: &[(String, String)]) -> Option<Arc<Opened>> {
        let eaw = q.iter().any(|(k, v)| k == "game" && v == "eaw");
        {
            let st = self.state.read().unwrap();
            if !eaw || st.foc.is_none() {
                return st.foc.clone();
            }
            if let Some(e) = &st.eaw {
                return e.clone();
            }
        }
        let mut st = self.state.write().unwrap();
        if st.eaw.is_none() {
            st.eaw = Some(st.dir.as_ref().map(|d| open(d, &self.mods, false)));
        }
        st.eaw.clone().flatten()
    }

    fn setup(&self) -> serde_json::Value {
        let st = self.state.read().unwrap();
        let versions = steam::workshop_versions();
        let sources: Vec<serde_json::Value> = st.sources.iter().map(|s| serde_json::json!({ "path": s.path, "kind": s.kind, "mods": setup::mods_in(s, &versions).len() })).collect();
        let missing = st
            .dir
            .as_deref()
            .map(vfs::missing_game_files)
            .unwrap_or_default();
        let ready = st.game_ready();
        // a phone or tablet has no folder dialog: the page tells the player where to copy the game
        #[cfg(mobile)]
        let copy_to = Some(setup::player_folder());
        #[cfg(desktop)]
        let copy_to: Option<PathBuf> = None;
        serde_json::json!({
            "game": {
                "path": st.dir, "how": st.how, "steam": st.steam, "ready": ready, "copyTo": copy_to,
                "missing": missing.iter().take(8).collect::<Vec<_>>(), "missingCount": missing.len(),
                "incomplete": missing.len() >= vfs::MISSING_IN_A_BROKEN_COPY
            },
            "sources": sources,
            "hidden": st.settings.hidden
        })
    }

    fn local_mods(&self) -> Vec<serde_json::Value> {
        let sources = self.state.read().unwrap().sources.clone();
        let versions = steam::workshop_versions();
        let mut found: Vec<setup::Found> = vec![];
        for f in sources.iter().flat_map(|s| setup::mods_in(s, &versions)) {
            if !found.iter().any(|x| setup::same(&x.folder, &f.folder)) {
                found.push(f);
            }
        }
        let own: Vec<Option<String>> = found.iter().map(|f| steam::info_name(&f.folder)).collect();
        let ids: Vec<String> = found
            .iter()
            .zip(&own)
            .filter(|(_, n)| n.is_none())
            .filter_map(|(f, _)| f.workshop.clone())
            .collect();
        let titles = workshop_names(&ids);
        found
            .into_iter()
            .zip(own)
            .map(|(f, own)| {
                let name = own.or_else(|| f.workshop.as_ref().and_then(|id| titles.get(id)).and_then(|t| t.as_str()).map(String::from));
                serde_json::json!({ "folder": f.folder, "workshop": f.workshop, "name": name, "version": f.version, "source": f.source })
            })
            .collect()
    }

    fn chosen(&self, path: &str) -> bool {
        self.picked
            .lock()
            .unwrap()
            .iter()
            .any(|p| setup::same(p, Path::new(path)))
    }

    fn set(&self, what: &str, arg: impl Fn(&str) -> Option<String>) -> Result<(), String> {
        match what {
            "" => {}
            "/game" => {
                let path = arg("path").unwrap_or_default();
                if !path.is_empty() && !self.chosen(&path) {
                    return Err("Choose the folder with Choose your game folder.".into());
                }
                if !path.is_empty() && !setup::is_game(Path::new(&path)) {
                    return Err("That folder has no GameData in it: choose the folder the game is installed in (the one with GameData and corruption, or GameData and EAWX for the GOG release).".into());
                }
                self.change(|s| s.game = (!path.is_empty()).then_some(path));
            }
            "/source" => {
                if let Some(a) = arg("add") {
                    if !self.chosen(&a) {
                        return Err("Choose the folder with Add a folder.".into());
                    }
                    if !Path::new(&a).is_dir() {
                        return Err("No such folder.".into());
                    }
                    self.change(|s| {
                        s.hidden
                            .retain(|h| !setup::same(Path::new(h), Path::new(&a)));
                        if !s
                            .sources
                            .iter()
                            .any(|x| setup::same(Path::new(x), Path::new(&a)))
                        {
                            s.sources.push(a.clone());
                        }
                    });
                } else if let Some(r) = arg("remove") {
                    let found = self
                        .state
                        .read()
                        .unwrap()
                        .sources
                        .iter()
                        .any(|s| s.kind != "added" && setup::same(&s.path, Path::new(&r)));
                    self.change(|s| {
                        s.sources
                            .retain(|x| !setup::same(Path::new(x), Path::new(&r)));
                        if found {
                            s.hidden.push(r.clone());
                        }
                    });
                } else if let Some(r) = arg("restore") {
                    self.change(|s| {
                        s.hidden
                            .retain(|h| !setup::same(Path::new(h), Path::new(&r)))
                    });
                }
            }
            _ => return Err("not found".into()),
        }
        Ok(())
    }

    fn channel(&self, set: Option<&str>) -> Result<serde_json::Value, String> {
        match set {
            Some("nightly") => {
                self.nightly.can_switch_back()?;
                self.nightly.refresh();
                self.change(|settings| settings.nightly = true);
            }
            Some("stable") => self.change(|settings| settings.nightly = false),
            Some(other) => return Err(format!("No such channel: {other}")),
            None => {}
        }
        let nightly = self.state.read().unwrap().settings.nightly;
        Ok(serde_json::json!({
            "channel": if nightly { "nightly" } else { "stable" },
            "site": self.nightly.site(),
            "build": if nightly { self.nightly.build() } else { None },
        }))
    }

    fn handle(&self, app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let uri = req.uri();
        let q = query(uri);
        let arg = |name: &str| q.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone());
        let Ok(p) = percent_encoding::percent_decode_str(uri.path()).decode_utf8() else {
            return text(400, "bad path");
        };
        let p = p.into_owned();
        // anything that changes settings, installs, writes a file or opens a dialog: a POST the app's own
        // code makes with its header, never a plain GET that a link, an image or a script's loadfile can make
        let changes = (p.starts_with("/api/setup/") && p != "/api/setup/")
            || p == "/api/update/install"
            || p == "/api/pick-folder"
            || p == "/api/save-report"
            || (p == "/api/channel" && arg("set").is_some());
        if changes
            && (req.method() != tauri::http::Method::POST || req.headers().get("x-swr").is_none())
        {
            return text(405, "use POST");
        }
        if let Some(rel) = p.strip_prefix("/asset/") {
            let which = self.game_for(&q);
            let assets = which.as_ref().map(|w| match arg("language") {
                Some(l) => w.game.game.for_language(vfs::language_id(&l).unwrap_or(0)),
                None => w.game.clone(),
            });
            let key = assets.as_ref().and_then(|a| a.resolve(rel));
            if key.is_none()
                && rel
                    .get(..18)
                    .is_some_and(|h| h.eq_ignore_ascii_case("Data/Fonts/Raster/"))
            {
                if let Some(w) = &which {
                    match w.fonts.asset(rel) {
                        Ok(Some(bytes)) => {
                            return send(
                                200,
                                bytes,
                                "application/json",
                                &[("Cache-Control", "max-age=86400")],
                            );
                        }
                        Ok(None) => {}
                        Err(e) => eprintln!("font raster: {e}"),
                    }
                }
            }
            let Some(key) = key else {
                return send(204, vec![], "text/plain; charset=utf-8", &[]);
            };
            let assets = assets.unwrap();
            let size = assets.size(&key).unwrap_or(0);
            return match vfs::range_of(
                req.headers().get("range").and_then(|v| v.to_str().ok()),
                size,
            ) {
                Some(Err(())) => send(
                    416,
                    vec![],
                    "text/plain; charset=utf-8",
                    &[("Content-Range", &format!("bytes */{size}"))],
                ),
                Some(Ok((a, b))) => match assets.read_part(&key, a, b - a + 1) {
                    Some(part) => send(
                        206,
                        part,
                        mime(&key),
                        &[
                            ("Content-Range", &format!("bytes {a}-{b}/{size}")),
                            ("Accept-Ranges", "bytes"),
                            ("Cache-Control", "max-age=86400"),
                        ],
                    ),
                    None => text(500, "unreadable"),
                },
                None => match assets.read(&key) {
                    Some(b) => send(
                        200,
                        b,
                        mime(&key),
                        &[
                            ("Accept-Ranges", "bytes"),
                            ("Cache-Control", "max-age=86400"),
                        ],
                    ),
                    None => text(500, "unreadable"),
                },
            };
        }
        if p == "/api/find" {
            let Some(w) = self.game_for(&q) else {
                return text(404, "no game mounted");
            };
            let pattern = arg("q").filter(|v| !v.is_empty()).unwrap_or(".".into());
            let Ok(rx) = regex::RegexBuilder::new(&pattern)
                .case_insensitive(true)
                .build()
            else {
                return text(400, "bad regex");
            };
            let mut out: Vec<&String> = w.game.index.keys().filter(|k| rx.is_match(k)).collect();
            out.sort();
            return json(&out);
        }
        if p == "/api/modinfo" {
            let key = arg("key")
                .map(|v| v.replace('/', "\\").to_uppercase())
                .unwrap_or_default();
            let at = self.game_for(&q).and_then(|w| {
                w.game.index.get(&key).and_then(|e| e.file()).map(|f| {
                    std::path::absolute(f)
                        .unwrap_or(f.to_path_buf())
                        .to_string_lossy()
                        .to_lowercase()
                })
            });
            let root = at.and_then(|at| {
                self.mods
                    .iter()
                    .map(|r| std::path::absolute(r).unwrap_or(r.clone()))
                    .filter(|r| {
                        at.starts_with(
                            &(r.to_string_lossy().to_lowercase() + std::path::MAIN_SEPARATOR_STR),
                        )
                    })
                    .last()
            });
            let info = root
                .and_then(|r| {
                    std::fs::read_dir(&r).ok()?.flatten().find(|e| {
                        e.file_name()
                            .to_string_lossy()
                            .eq_ignore_ascii_case("modinfo.json")
                    })
                })
                .and_then(|e| std::fs::read_to_string(e.path()).ok())
                .and_then(|s| {
                    serde_json::from_str::<serde_json::Value>(s.trim_start_matches('\u{feff}')).ok()
                })
                .unwrap_or(serde_json::Value::Null);
            return json(&info);
        }
        if p == "/api/workshop" {
            let ids: Vec<String> = arg("ids")
                .map(|v| {
                    v.split(',')
                        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
                        .map(String::from)
                        .collect()
                })
                .unwrap_or_default();
            return json(&workshop_names(&ids));
        }
        if p == "/api/channel" {
            return match self.channel(arg("set").as_deref()) {
                Ok(info) => json(&info),
                Err(error) => text(400, &error),
            };
        }
        if p == "/api/app" {
            let i = app.package_info();
            return json(&serde_json::json!({ "name": i.name, "version": i.version.to_string() }));
        }
        if let Some(what) = p.strip_prefix("/api/update/") {
            static UPDATES: std::sync::OnceLock<update::Updates> = std::sync::OnceLock::new();
            let u = UPDATES.get_or_init(update::Updates::default);
            return match what {
                "check" => json(&u.check(app)),
                "install" => match u.install(app) {
                    Ok(()) => json(&u.progress()),
                    Err(e) => text(400, &e),
                },
                "progress" => json(&u.progress()),
                _ => text(404, "not found"),
            };
        }
        if p == "/api/mounted" {
            let versions = steam::workshop_versions();
            let list: Vec<serde_json::Value> = self
                .mods
                .iter()
                .map(|root| {
                    let folder = root
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    let workshop = folder
                        .chars()
                        .all(|c| c.is_ascii_digit())
                        .then(|| folder.clone())
                        .filter(|f| !f.is_empty());
                    let version = workshop.as_ref().and_then(|id| versions.get(id)).cloned();
                    serde_json::json!({
                        "name": steam::info_name(root).unwrap_or_else(|| folder.clone()),
                        "folder": folder,
                        "workshop": workshop,
                        "version": version
                    })
                })
                .collect();
            return json(&list);
        }
        if p == "/api/localmods" {
            return json(&self.local_mods());
        }
        if let Some(what) = p.strip_prefix("/api/setup") {
            return match self.set(what, arg) {
                Ok(()) => json(&self.setup()),
                Err(e) => text(400, &e),
            };
        }
        // a phone or tablet shows the app full screen: there is no window to size, confine
        // the cursor in, or pick folders from (the game lives in the app's own folder there)
        #[cfg(mobile)]
        if matches!(p.as_str(), "/api/window-size" | "/api/cursor-grab") {
            return json(&serde_json::json!({ "ok": false }));
        }
        #[cfg(mobile)]
        if p == "/api/pick-folder" {
            return json(&serde_json::json!({ "path": null }));
        }
        #[cfg(desktop)]
        if p == "/api/window-size" {
            let num = |k: &str| arg(k).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
            let (w, h) = (num("w"), num("h"));
            if let Some(win) = app.get_webview_window("main") {
                let monitor = win.current_monitor().ok().flatten();
                let frame = match (win.outer_size(), win.inner_size()) {
                    (Ok(o), Ok(i)) => {
                        let side = o.width.saturating_sub(i.width) / 2;
                        (side, o.height.saturating_sub(i.height).saturating_sub(side))
                    }
                    _ => (0, 0),
                };
                let room = monitor.as_ref().map(|m| {
                    let a = m.work_area();
                    (
                        a.position,
                        a.size.width,
                        a.size.height.saturating_sub(frame.1),
                    )
                });
                if w >= 640 && h >= 480 && !win.is_fullscreen().unwrap_or(false) {
                    match room {
                        Some((at, rw, rh)) if w <= rw && h <= rh => {
                            let _ = win.unmaximize();
                            let _ = win.set_size(tauri::PhysicalSize::new(w, h));
                            let x = at.x + ((rw - w) / 2) as i32 - frame.0 as i32;
                            let y = at.y + ((rh - h) / 2) as i32;
                            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                        }
                        Some(_) => {
                            let _ = win.maximize();
                        }
                        None => {
                            let _ = win.unmaximize();
                            let _ = win.set_size(tauri::PhysicalSize::new(w, h));
                            let _ = win.center();
                        }
                    }
                }
                let size = win.inner_size().ok();
                let full = monitor.as_ref().map(|m| *m.size());
                return json(&serde_json::json!({
                    "w": size.map(|s| s.width), "h": size.map(|s| s.height),
                    "mw": full.map(|s| s.width), "mh": full.map(|s| s.height),
                    "fw": room.map(|r| r.1), "fh": room.map(|r| r.2),
                    "max": win.is_maximized().unwrap_or(false)
                }));
            }
            return json(&serde_json::json!({ "ok": false }));
        }
        if p == "/api/discord" {
            if arg("on").as_deref() == Some("0") {
                discord::set(None);
            } else {
                discord::set(Some(discord::Status {
                    details: arg("details").unwrap_or_default(),
                    state: arg("state").unwrap_or_default(),
                    large_text: arg("large").unwrap_or_default(),
                    start: arg("start").and_then(|v| v.parse().ok()).unwrap_or(0),
                }));
            }
            return json(&serde_json::json!({ "ok": true }));
        }
        if p == "/api/fullscreen" {
            if let Some(win) = app.get_webview_window("main") {
                #[cfg(desktop)]
                if let Some(on) = arg("on") {
                    let on = on == "1";
                    if on != win.is_fullscreen().unwrap_or(false) {
                        let _ = win.set_fullscreen(on);
                    }
                }
                return json(
                    &serde_json::json!({ "fullscreen": win.is_fullscreen().unwrap_or(false) }),
                );
            }
            return json(&serde_json::json!({ "fullscreen": false }));
        }
        #[cfg(desktop)]
        if p == "/api/cursor-grab" {
            let on = arg("on").as_deref() == Some("1");
            // on Windows the page sends what it wants (mode) and the app keeps to it whenever
            // the game window is in front; `on` is the page's own guess, for older pages
            #[cfg(windows)]
            {
                let mode = match arg("mode").as_deref() {
                    Some("always") => cursorclip::ALWAYS,
                    Some("fullscreen") => cursorclip::FULLSCREEN,
                    Some(_) => cursorclip::OFF,
                    None if on => cursorclip::ALWAYS,
                    None => cursorclip::OFF,
                };
                // a page from before mode lets go whenever it loses focus and asks again only
                // when its own frame gets focus back, which may not happen: while the window is
                // behind, its letting go is left to the watch here
                if arg("mode").is_none() && !on && !cursorclip::in_front() {
                    cursorclip::log("older page let go while behind: kept");
                } else {
                    cursorclip::set_mode(mode);
                }
                if let Some(w) = app.get_webview_window("main") {
                    cursorclip::set_fullscreen(w.is_fullscreen().unwrap_or(false));
                    sync_grab(&w.as_ref().window());
                }
            }
            #[cfg(not(windows))]
            {
                CURSOR_GRAB.store(on, Ordering::Relaxed);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_cursor_grab(on);
                }
            }
            return json(&serde_json::json!({ "ok": true }));
        }
        #[cfg(windows)]
        if p == "/api/window-log" {
            if let Some(note) = arg("note") {
                cursorclip::log(format!(
                    "page: {}",
                    note.chars().take(200).collect::<String>()
                ));
                return json(&serde_json::json!({ "ok": true }));
            }
            return json(&serde_json::json!({ "lines": cursorclip::log_lines() }));
        }
        if p == "/api/power" {
            return json(&report::power());
        }
        if p == "/api/process-stats" {
            return json(&procstats::stats());
        }
        if p == "/api/screenshot" {
            return match report::screenshot(app) {
                Some(png) => send(200, png, "image/png", &[("Cache-Control", "no-store")]),
                None => text(503, "screenshot unavailable"),
            };
        }
        if p == "/api/save-report" {
            let name = arg("name").unwrap_or_else(|| "bug-report.zip".into());
            return match report::save(app, &name, req.body()) {
                Ok(path) => json(&serde_json::json!({ "path": path })),
                Err(e) => text(500, &e),
            };
        }
        #[cfg(desktop)]
        if p == "/api/pick-folder" {
            let mut d =
                rfd::FileDialog::new().set_title(arg("title").unwrap_or("Choose a folder".into()));
            if let Some(w) = app.get_webview_window("main") {
                d = d.set_parent(&w);
            }
            if let Some(from) = arg("from").map(PathBuf::from).filter(|p| p.is_dir()) {
                d = d.set_directory(from);
            }
            let path = d.pick_folder();
            if let Some(p) = &path {
                self.picked.lock().unwrap().push(p.clone());
            }
            return json(&serde_json::json!({ "path": path }));
        }
        if let Some(what) = p.strip_prefix("/api/local/") {
            let Some(path) = arg("path").map(PathBuf::from).filter(|p| self.may_read(p)) else {
                return text(403, "forbidden");
            };
            return match what {
                "list" => match std::fs::read_dir(&path) {
                    Ok(list) => {
                        let out: Vec<serde_json::Value> = list
                            .flatten()
                            .filter_map(|e| {
                                let m = e.metadata().ok()?;
                                Some(serde_json::json!([
                                    e.file_name().to_string_lossy(),
                                    m.is_dir(),
                                    if m.is_dir() { 0 } else { m.len() }
                                ]))
                            })
                            .collect();
                        json(&out)
                    }
                    Err(_) => text(404, "not found"),
                },
                "file" => ranged(
                    &path,
                    req.headers().get("range").and_then(|v| v.to_str().ok()),
                ),
                _ => text(404, "not found"),
            };
        }
        let rel = if p == "/" {
            "index.html".to_string()
        } else {
            p[1..].to_string()
        };
        if rel.split(['/', '\\']).any(|s| s == "..") || !nightly::plain_relative(&rel) {
            return text(403, "forbidden");
        }
        let nightly = self.state.read().unwrap().settings.nightly;
        if nightly && rel.to_lowercase().ends_with(".html") {
            self.nightly.refresh();
        }
        let bytes = nightly
            .then(|| self.nightly.file(&rel))
            .flatten()
            .or_else(|| match &self.public {
                Some(dir) => std::fs::read(dir.join(&rel)).ok(),
                None => app
                    .asset_resolver()
                    .get(rel.clone())
                    .filter(|a| {
                        !a.mime_type.contains("html") || rel.to_lowercase().ends_with(".html")
                    })
                    .map(|a| a.bytes.to_vec()),
            });
        let Some(bytes) = bytes else {
            return text(404, &format!("not found: {rel}"));
        };
        let profile = rel.to_lowercase().ends_with(".html") || arg("jsprofile").is_some();
        let mut extra = vec![("Cache-Control", "no-cache")];
        if rel.to_lowercase().ends_with(".html") {
            extra.push(("Content-Security-Policy", CSP));
        }
        if profile {
            extra.push(("Document-Policy", "js-profiling"));
        }
        if rel == "js/consolelog.js" {
            extra.push(("SourceMap", "consolelog.js.map"));
        }
        send(200, bytes, mime(&rel), &extra)
    }
}

/// WebKitGTK's DMA-BUF renderer shows a blank window with NVIDIA's own driver; it is turned off
/// there unless the player chose a setting of their own.
#[cfg(target_os = "linux")]
fn prepare_linux_webview() {
    const SETTING: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(SETTING).is_none() && Path::new("/proc/driver/nvidia").exists() {
        // still one thread: nothing else reads the environment yet
        unsafe { std::env::set_var(SETTING, "1") };
    }
}

/// The app: the desktop binary calls it from main, Android and iOS start it themselves.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    prepare_linux_webview();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let env_game = std::env::var_os("SWR_GAME")
        .map(PathBuf::from)
        .filter(|d| d.is_dir());
    let fallback = cfg!(debug_assertions)
        .then(|| here.join("..").join("..").join("Star Wars Empire at War"))
        .filter(|d| setup::is_game(d));
    let settings = Settings::load();
    let flags = format!(
        "{TAURI_ARGS}{}",
        if settings.uncapped {
            format!(" {UNCAPPED}")
        } else {
            String::new()
        }
    );
    let first = env_game
        .clone()
        .or_else(|| {
            settings
                .game
                .as_ref()
                .map(PathBuf::from)
                .filter(|p| setup::is_game(p))
        })
        .or_else(|| {
            found_game(steam::game_folder().as_deref(), fallback.as_deref()).map(|(found, _)| found)
        });
    let mods = first
        .as_ref()
        // an invite link is the only argument a browser passes: never read mod options next to it
        .map(|d| match invite::find_link(&args) {
            Some(_) => steam::mods(&[], d),
            None => steam::mods(&args, d),
        })
        .unwrap_or_default();
    let public = std::env::var_os("SWR_PUBLIC")
        .map(PathBuf::from)
        .or_else(|| cfg!(debug_assertions).then(|| here.join("..").join("public")))
        // a development build on a phone has no source folder: it serves its bundled pages
        .filter(|dir| dir.is_dir());
    let blank = State {
        settings: Settings::default(),
        dir: None,
        how: "none",
        steam: None,
        foc: None,
        eaw: None,
        sources: vec![],
        local: vec![],
    };
    let mut server = Server {
        mods,
        public,
        env_game,
        fallback,
        nightly: nightly::Nightly::new(setup::data_dir().join("nightly")),
        state: RwLock::new(blank),
        picked: Mutex::new(vec![]),
    };
    let settled = server.settle(settings, None);
    server.state = RwLock::new(settled);
    let server = Arc::new(server);

    invite::register();
    let invited = invite::find_link(&args).and_then(|link| invite::page_query(&link));
    let page = match invited {
        Some(query) => format!("play.html?{query}"),
        None => std::env::var("SWR_PAGE").unwrap_or_else(|_| "index.html".into()),
    };
    let url = std::env::var("SWR_URL").unwrap_or_else(|_| {
        // WebView2 and Android's WebView serve custom schemes as http://<scheme>.localhost
        if cfg!(any(windows, target_os = "android")) {
            format!("http://swr.localhost/{page}")
        } else {
            format!("swr://localhost/{page}")
        }
    });
    let flags = format!("{flags} {}", std::env::var("SWR_ARGS").unwrap_or_default());
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            open_invite(app, &args)
        }))
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .register_asynchronous_uri_scheme_protocol("swr", move |ctx, req, responder| {
            let (server, app) = (server.clone(), ctx.app_handle().clone());
            std::thread::spawn(move || responder.respond(server.handle(&app, &req)));
        })
        // a new page starts with the mouse free: only the game page asks for it to be kept in,
        // and it asks again once it starts, so leaving it for the launcher lets go
        .on_page_load(|webview, payload| {
            #[cfg(desktop)]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                #[cfg(windows)]
                {
                    cursorclip::log("page load: mouse free");
                    cursorclip::set_mode(cursorclip::OFF);
                    sync_grab(&webview.window());
                }
                #[cfg(not(windows))]
                {
                    CURSOR_GRAB.store(false, Ordering::Relaxed);
                    let _ = webview.window().set_cursor_grab(false);
                }
            }
            #[cfg(mobile)]
            let _ = (webview, payload);
        })
        .on_window_event(|w, e| {
            // a phone or tablet window is always the whole screen: nothing to keep up with
            #[cfg(mobile)]
            let _ = (w, e);
            #[cfg(desktop)]
            if matches!(
                e,
                tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) && CURSOR_GRAB.load(Ordering::Relaxed)
            {
                let _ = w.set_cursor_grab(true);
            }
            #[cfg(windows)]
            if matches!(
                e,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
            ) {
                let full = w.is_fullscreen().unwrap_or(false);
                cursorclip::set_fullscreen(full);
                sync_grab(w);
                if let (Ok(Some(m)), Ok(h)) = (w.current_monitor(), w.hwnd()) {
                    let h = h.0 as isize;
                    // in fullscreen the window is kept where fullscreen_rect puts it, whatever
                    // moved it (entering fullscreen, Alt+Tab, a monitor or resolution change)
                    if full {
                        let others: Vec<_> = w
                            .available_monitors()
                            .unwrap_or_default()
                            .iter()
                            .filter(|o| o.position() != m.position())
                            .map(|o| (*o.position(), *o.size()))
                            .collect();
                        let want = fullscreen_rect(*m.position(), *m.size(), &others);
                        let now = match (w.outer_position(), w.outer_size()) {
                            (Ok(p), Ok(s)) => (p.x, p.y, s.width as i32, s.height as i32),
                            _ => want,
                        };
                        if now != want {
                            cursorclip::log(format!(
                                "fullscreen window at {now:?}, placed at {want:?}"
                            ));
                            place_window(h, want);
                        }
                    }
                    if full != TASKBAR_FULL.swap(full, Ordering::Relaxed) {
                        mark_fullscreen(h, full);
                    }
                }
            }
        })
        .setup(move |app| {
            audio::name_sessions("Empire at War Browser Edition");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("Empire at War Browser Edition")
                .inner_size(1600.0, 900.0)
                .additional_browser_args(flags.trim())
                .build()?;
            #[cfg(windows)]
            if let Some(Ok(h)) = app.get_webview_window("main").map(|w| w.hwnd()) {
                let handle = app.handle().clone();
                // the page refreshes its cursor on coming back: its own focus event goes to
                // whichever frame had focus, so the app tells it instead
                cursorclip::start(h.0 as isize, move || {
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.eval("window.swrCameToFront && window.swrCameToFront()");
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(handle_run_event);
}

/// macOS hands invite links to the running app as open-URL events, not as arguments.
#[cfg(target_os = "macos")]
fn handle_run_event(app: &AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Opened { urls } = event {
        let links: Vec<String> = urls.iter().map(|url| url.to_string()).collect();
        open_invite(app, &links);
    }
}

#[cfg(not(target_os = "macos"))]
fn handle_run_event(_app: &AppHandle, _event: tauri::RunEvent) {}

/// A second start of the app (an invite link clicked while it runs) brings this window
/// forward and joins the game. Leaving a running battle still asks first.
#[cfg(desktop)]
fn open_invite(app: &AppHandle, args: &[String]) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    if let Some(query) = invite::find_link(args).and_then(|link| invite::page_query(&link)) {
        let page = serde_json::to_string(&format!("play.html?{query}")).unwrap();
        let _ = window.eval(format!("location.href = {page};"));
    }
}

/// Where the fullscreen window goes. A window exactly the size of the monitor gets scanned
/// out directly, and some drivers stop drawing the mouse there after Alt+Tab, so the window
/// reaches one pixel past an edge of the monitor instead: the whole screen still shows the
/// game and the mouse reaches every edge. The edge picked has no other monitor beside it, so
/// nothing shows there; with monitors on all four sides it stays one pixel short instead.
#[cfg(windows)]
fn fullscreen_rect(
    at: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    others: &[(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)],
) -> (i32, i32, i32, i32) {
    let (x0, y0) = (at.x, at.y);
    let (x1, y1) = (x0 + size.width as i32, y0 + size.height as i32);
    let side = |o: &(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)| {
        let (ox0, oy0) = (o.0.x, o.0.y);
        let (ox1, oy1) = (ox0 + o.1.width as i32, oy0 + o.1.height as i32);
        let across = ox0 < x1 && ox1 > x0;
        let along = oy0 < y1 && oy1 > y0;
        [
            across && oy0 == y1,
            across && oy1 == y0,
            along && ox0 == x1,
            along && ox1 == x0,
        ]
    };
    let mut taken = [false; 4];
    for o in others {
        for (t, s) in taken.iter_mut().zip(side(o)) {
            *t |= s;
        }
    }
    let (w, ht) = (x1 - x0, y1 - y0);
    match taken.iter().position(|t| !t) {
        Some(1) => (x0, y0 - 1, w, ht + 1),
        Some(2) => (x0, y0, w + 1, ht),
        Some(3) => (x0 - 1, y0, w + 1, ht),
        Some(_) => (x0, y0, w, ht + 1),
        None => (x0, y0, w, ht - 1),
    }
}

#[cfg(windows)]
fn place_window(h: isize, (x, y, w, ht): (i32, i32, i32, i32)) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos};
    unsafe {
        let _ = SetWindowPos(
            HWND(h as _),
            None,
            x,
            y,
            w,
            ht,
            SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

/// tao clips the mouse too when its grab is on, and lets go of any clip when it is off, so
/// its grab follows ours: on whenever the page's choice applies, whichever window is in front.
#[cfg(windows)]
fn sync_grab<R: tauri::Runtime>(w: &tauri::Window<R>) {
    let on = cursorclip::wanted();
    if on != CURSOR_GRAB.swap(on, Ordering::Relaxed) || on {
        let _ = w.set_cursor_grab(on);
    }
}

#[cfg(windows)]
fn mark_fullscreen(h: isize, on: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
    };
    use windows::Win32::UI::Shell::{ITaskbarList2, TaskbarList};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if let Ok(list) =
            CoCreateInstance::<_, ITaskbarList2>(&TaskbarList, None, CLSCTX_INPROC_SERVER)
        {
            if list.HrInit().is_ok() {
                let _ = list.MarkFullscreenWindow(HWND(h as _), on);
            }
        }
    }
}
