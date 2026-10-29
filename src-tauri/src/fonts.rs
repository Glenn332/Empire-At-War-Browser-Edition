use crate::vfs::View;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

const SCRIPT: &str = include_str!("../../tools/gdi-font.ps1");

struct Names {
    family: String,
    full: String,
}

fn font_names(d: &[u8]) -> Option<Names> {
    let u16at = |p: usize| {
        d.get(p..p + 2)
            .map(|b| u16::from_be_bytes([b[0], b[1]]) as usize)
    };
    let u32at = |p: usize| {
        d.get(p..p + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };
    let tag = u32at(0)?;
    if d.len() < 12 || ![0x00010000, 0x4f54544f, 0x74727565].contains(&tag) {
        return None;
    }
    let n = u16at(4)?;
    let mut name = None;
    for k in 0..n {
        let o = 12 + k * 16;
        if o + 16 > d.len() {
            break;
        }
        if &d[o..o + 4] == b"name" {
            name = u32at(o + 8);
        }
    }
    let at = name?;
    let (count, strings) = (u16at(at + 2)?, at + u16at(at + 4)?);
    let mut names: HashMap<usize, String> = HashMap::new();
    for (want, english) in [(3, true), (3, false), (0, false), (1, false)] {
        for k in 0..count {
            let o = at + 6 + k * 12;
            let (Some(platform), Some(id)) = (u16at(o), u16at(o + 6)) else {
                continue;
            };
            if platform != want || (id != 1 && id != 4) || names.contains_key(&id) {
                continue;
            }
            if platform == 3
                && (![0, 1, 10].contains(&u16at(o + 2).unwrap_or(99))
                    || (english && u16at(o + 4) != Some(0x409)))
            {
                continue;
            }
            let (Some(len), Some(from)) = (u16at(o + 8), u16at(o + 10)) else {
                continue;
            };
            let from = strings + from;
            if from + len > d.len() {
                continue;
            }
            let s = if platform == 1 {
                d[from..from + len]
                    .iter()
                    .map(|&c| c as char)
                    .collect::<String>()
            } else {
                String::from_utf16_lossy(
                    &d[from..from + len]
                        .chunks_exact(2)
                        .map(|c| u16::from_be_bytes([c[0], c[1]]))
                        .collect::<Vec<_>>(),
                )
            };
            if !s.trim().is_empty() {
                names.insert(id, s.trim().to_string());
            }
        }
    }
    let pick = |a: usize, b: usize| names.get(&a).or(names.get(&b)).cloned().unwrap_or_default();
    Some(Names {
        family: pick(1, 4),
        full: pick(4, 1),
    })
}

struct Worker {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Worker {
    fn ask(&mut self, value: &serde_json::Value) -> Result<serde_json::Value, String> {
        writeln!(self.stdin, "{value}").map_err(|e| e.to_string())?;
        let mut line = String::new();
        if self
            .stdout
            .read_line(&mut line)
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("GDI worker exited".into());
        }
        let v: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        match v.get("error").and_then(|e| e.as_str()) {
            Some(e) => Err(e.to_string()),
            None => Ok(v),
        }
    }
}

struct Started {
    directory: PathBuf,
    alias: HashMap<String, Option<String>>,
    worker: Mutex<Option<Worker>>,
    fonts: Vec<String>,
}

pub struct NativeFonts {
    game: Arc<View>,
    started: OnceLock<Result<Started, String>>,
}

fn sha256_hex(parts: &[&[u8]]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn decode(s: &str) -> Option<String> {
    percent_encoding::percent_decode_str(s)
        .decode_utf8()
        .ok()
        .map(|c| c.into_owned())
}

impl NativeFonts {
    pub fn new(game: Arc<View>) -> Self {
        NativeFonts {
            game,
            started: OnceLock::new(),
        }
    }

    fn start(&self) -> Result<&Started, String> {
        self.started
            .get_or_init(|| {
                let rx = regex::Regex::new(r"^DATA\\FONTS\\.*\.(TTF|OTF)$").unwrap();
                let keys: Vec<&String> = self
                    .game
                    .index
                    .keys()
                    .filter(|k| rx.is_match(k) && !k.starts_with("DATA\\FONTS\\GAME\\"))
                    .collect();
                let fonts: Vec<Vec<u8>> = keys
                    .iter()
                    .map(|k| self.game.read(k).unwrap_or_default())
                    .collect();
                let mut claims = vec![];
                for (k, bytes) in keys.iter().zip(&fonts) {
                    let Some(info) = font_names(bytes) else {
                        continue;
                    };
                    let exe = self.game.index[*k]
                        .file()
                        .is_some_and(|f| f.to_string_lossy().to_lowercase().ends_with(".exe"));
                    let face = k.rsplit(['\\', '/']).next().unwrap_or(k);
                    let face = face
                        .strip_suffix(".TTF")
                        .or(face.strip_suffix(".OTF"))
                        .unwrap_or(face)
                        .to_string();
                    for (kind, name) in [face, info.full.clone(), info.family.clone()]
                        .into_iter()
                        .enumerate()
                    {
                        if !name.is_empty() {
                            claims.push((exe, kind, name, info.full.clone(), info.family.clone()));
                        }
                    }
                }
                claims.sort_by_key(|c| (c.0, c.1));
                let mut alias = HashMap::new();
                for (_, _, name, full, family) in claims {
                    let up = name.to_uppercase();
                    if !alias.contains_key(&up) {
                        let own = full.to_uppercase() == up || family.to_uppercase() == up;
                        alias.insert(up, if own { None } else { Some(full) });
                    }
                }
                let mut parts: Vec<&[u8]> = vec![b"GDI4-v4"];
                parts.extend(fonts.iter().map(|f| f.as_slice()));
                let directory = std::env::temp_dir()
                    .join("sw-revival-fonts")
                    .join(&sha256_hex(&parts)[..24]);
                std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
                let b64 = base64::engine::general_purpose::STANDARD;
                Ok(Started {
                    directory,
                    alias,
                    worker: Mutex::new(None),
                    fonts: fonts.iter().map(|f| b64.encode(f)).collect(),
                })
            })
            .as_ref()
            .map_err(|e| e.clone())
    }

    fn worker(s: &Started) -> Result<Worker, String> {
        let script = std::env::temp_dir()
            .join("sw-revival-fonts")
            .join("gdi-font.ps1");
        std::fs::write(&script, SCRIPT).map_err(|e| e.to_string())?;
        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
        #[cfg(windows)]
        std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x08000000);
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let mut w = Worker {
            stdin: child.stdin.take().unwrap(),
            stdout: BufReader::new(child.stdout.take().unwrap()),
            _child: child,
        };
        w.ask(&serde_json::json!({ "fonts": s.fonts }))?;
        Ok(w)
    }

    pub fn asset(&self, name: &str) -> Result<Option<Vec<u8>>, String> {
        let rx = regex::Regex::new(r"(?i)^DATA[\\/]FONTS[\\/]RASTER[\\/]([^\\/]+)~(\d+)~(f?\d+)~(\d+)(~b1)?(?:~c(\d+))?\.JSON$").unwrap();
        let Some(m) = rx.captures(name) else {
            return Ok(None);
        };
        let Some(face) = decode(&m[1]) else {
            return Ok(None);
        };
        let (height, page): (f64, f64) = (
            m[2].parse().unwrap_or(f64::INFINITY),
            m[4].parse().unwrap_or(f64::INFINITY),
        );
        let s = &m[3];
        let stretch = if s.starts_with(['f', 'F']) {
            f32::from_bits(
                s[1..]
                    .parse::<f64>()
                    .map(|v| (v as i64 as u64 & 0xffff_ffff) as u32)
                    .unwrap_or(0),
            ) as f64
        } else {
            s.parse::<f64>().unwrap_or(f64::NAN) / 1000.0
        };
        let bold = m.get(5).is_some();
        let charset: f64 = m
            .get(6)
            .map_or(0.0, |c| c.as_str().parse().unwrap_or(f64::NAN));
        if face.chars().count() > 100
            || !(1.0..=256.0).contains(&height)
            || !stretch.is_finite()
            || stretch <= 0.0
            || stretch > 16.0
            || page > 255.0
            || ![0.0, 128.0].contains(&charset)
        {
            return Ok(None);
        }
        let started = self.start()?;
        let num = |v: f64| {
            if v.fract() == 0.0 {
                format!("{}", v as i64)
            } else {
                format!("{v}")
            }
        };
        let key = format!(
            "[{},{},{},{},{},{}]",
            serde_json::to_string(&face.to_uppercase()).unwrap(),
            height,
            num(stretch),
            page,
            bold,
            charset
        );
        let file = started
            .directory
            .join(sha256_hex(&[key.as_bytes()]) + ".json");
        let mut worker = started.worker.lock().unwrap();
        if let Ok(b) = std::fs::read(&file) {
            return Ok(Some(b));
        }
        if worker.is_none() {
            *worker = Some(Self::worker(started)?);
        }
        let asked = started
            .alias
            .get(&face.to_uppercase())
            .cloned()
            .flatten()
            .unwrap_or(face.clone());
        let reply = worker.as_mut().unwrap().ask(&serde_json::json!({ "face": asked, "height": height as u32, "stretch": stretch, "page": page as u32, "bold": bold, "charset": charset as u32 }));
        let mut value = match reply {
            Ok(v) => v,
            Err(e) => {
                *worker = None;
                return Err(e);
            }
        };
        let b64 = base64::engine::general_purpose::STANDARD;
        let mask = b64
            .decode(value["mask"].as_str().unwrap_or(""))
            .map_err(|e| e.to_string())?;
        let mut gz = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
        gz.write_all(&mask).map_err(|e| e.to_string())?;
        value["mask"] = b64.encode(gz.finish().map_err(|e| e.to_string())?).into();
        value["compression"] = "gzip".into();
        let bytes = serde_json::to_vec(&value).unwrap();
        let _ = std::fs::write(&file, &bytes);
        Ok(Some(bytes))
    }
}
