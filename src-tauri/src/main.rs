#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod fonts;
mod setup;
mod steam;
mod update;
mod vfs;

use fonts::NativeFonts;
use setup::{Settings, Source};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use vfs::{Game, View};

const TAURI_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
const UNCAPPED: &str = "--disable-frame-rate-limit --disable-gpu-vsync";

struct Opened {
    game: Arc<View>,
    fonts: NativeFonts,
}

struct Server {
    mods: Vec<PathBuf>,
    public: Option<PathBuf>,
    env_game: Option<PathBuf>,
    fallback: Option<PathBuf>,
    state: RwLock<State>,
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
            )
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
        } else if let Some(s) = &steam {
            (Some(s.clone()), "steam")
        } else if let Some(f) = &self.fallback {
            (Some(f.clone()), "dev")
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
        if let Some(w) = was.filter(|w| w.dir.is_some() && w.dir == dir) {
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
        serde_json::json!({ "game": { "path": st.dir, "how": st.how, "steam": st.steam }, "sources": sources, "hidden": st.settings.hidden })
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

    fn set(&self, what: &str, arg: impl Fn(&str) -> Option<String>) -> Result<(), String> {
        match what {
            "" => {}
            "/game" => {
                let path = arg("path").unwrap_or_default();
                if !path.is_empty() && !setup::is_game(Path::new(&path)) {
                    return Err("That folder has no GameData in it: choose the folder the game is installed in (the one with GameData and corruption).".into());
                }
                self.change(|s| s.game = (!path.is_empty()).then_some(path));
            }
            "/source" => {
                if let Some(a) = arg("add") {
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

    fn handle(&self, app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let uri = req.uri();
        let q = query(uri);
        let arg = |name: &str| q.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone());
        let Ok(p) = percent_encoding::percent_decode_str(uri.path()).decode_utf8() else {
            return text(400, "bad path");
        };
        let p = p.into_owned();
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
                            )
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
        if p == "/api/localmods" {
            return json(&self.local_mods());
        }
        if let Some(what) = p.strip_prefix("/api/setup") {
            return match self.set(what, arg) {
                Ok(()) => json(&self.setup()),
                Err(e) => text(400, &e),
            };
        }
        if p == "/api/pick-folder" {
            let mut d =
                rfd::FileDialog::new().set_title(arg("title").unwrap_or("Choose a folder".into()));
            if let Some(w) = app.get_webview_window("main") {
                d = d.set_parent(&w);
            }
            if let Some(from) = arg("from").map(PathBuf::from).filter(|p| p.is_dir()) {
                d = d.set_directory(from);
            }
            return json(&serde_json::json!({ "path": d.pick_folder() }));
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
        if rel.split(['/', '\\']).any(|s| s == "..") {
            return text(403, "forbidden");
        }
        let bytes = match &self.public {
            Some(dir) => std::fs::read(dir.join(&rel)).ok(),
            None => app
                .asset_resolver()
                .get(rel.clone())
                .filter(|a| !a.mime_type.contains("html") || rel.to_lowercase().ends_with(".html"))
                .map(|a| a.bytes.to_vec()),
        };
        let Some(bytes) = bytes else {
            return text(404, &format!("not found: {rel}"));
        };
        let profile = rel.to_lowercase().ends_with(".html") || arg("jsprofile").is_some();
        let mut extra = vec![("Cache-Control", "no-cache")];
        if profile {
            extra.push(("Document-Policy", "js-profiling"));
        }
        send(200, bytes, mime(&rel), &extra)
    }
}

fn main() {
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
        .or_else(steam::game_folder)
        .or_else(|| fallback.clone());
    let mods = first
        .as_ref()
        .map(|d| steam::mods(&args, d))
        .unwrap_or_default();
    let public = std::env::var_os("SWR_PUBLIC")
        .map(PathBuf::from)
        .or_else(|| cfg!(debug_assertions).then(|| here.join("..").join("public")));
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
        state: RwLock::new(blank),
    };
    let settled = server.settle(settings, None);
    server.state = RwLock::new(settled);
    let server = Arc::new(server);

    let page = std::env::var("SWR_PAGE").unwrap_or_else(|_| "index.html".into());
    let url = std::env::var("SWR_URL").unwrap_or_else(|_| {
        if cfg!(windows) {
            format!("http://swr.localhost/{page}")
        } else {
            format!("swr://localhost/{page}")
        }
    });
    let flags = format!("{flags} {}", std::env::var("SWR_ARGS").unwrap_or_default());
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("swr", move |ctx, req, responder| {
            let (server, app) = (server.clone(), ctx.app_handle().clone());
            std::thread::spawn(move || responder.respond(server.handle(&app, &req)));
        })
        .setup(move |app| {
            audio::name_sessions("Empire at War Browser Edition");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("Empire at War Browser Edition")
                .inner_size(1600.0, 900.0)
                .additional_browser_args(flags.trim())
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
