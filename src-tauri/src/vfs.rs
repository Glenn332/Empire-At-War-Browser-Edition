use indexmap::IndexMap;
use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const LANGUAGES: [&str; 11] = ["ENGLISH", "GERMAN", "FRENCH", "SPANISH", "ITALIAN", "JAPANESE", "KOREAN", "CHINESE", "RUSSIAN", "POLISH", "THAI"];

pub fn language_id(value: &str) -> Option<usize> {
    if value.is_empty() {
        return None;
    }
    let id = if value.bytes().all(|b| b.is_ascii_digit()) { value.parse::<usize>().ok()? } else { LANGUAGES.iter().position(|l| *l == value.to_uppercase())? };
    (id < LANGUAGES.len()).then_some(id)
}

fn language_name(id: usize) -> String {
    LANGUAGES[id].to_lowercase()
}

#[derive(Clone)]
pub enum Src {
    Meg(usize),
    File(Arc<PathBuf>),
}

#[derive(Clone)]
pub struct Entry {
    pub src: Src,
    pub off: Option<u64>,
    pub size: u64,
}

impl Entry {
    pub fn file(&self) -> Option<&Path> {
        match &self.src {
            Src::File(f) => Some(f),
            Src::Meg(_) => None,
        }
    }
}

type Entries = IndexMap<String, Option<Entry>>;
pub type Index = IndexMap<String, Entry>;

struct Layer {
    root: Option<PathBuf>,
    entries: Entries,
}

#[derive(Default)]
struct Files {
    paths: Vec<PathBuf>,
    handles: Vec<Arc<File>>,
}

pub struct Game {
    layers: Vec<Layer>,
    fonts: Vec<(String, Entry)>,
    files: Mutex<Files>,
    languages: Mutex<HashMap<usize, Arc<View>>>,
}

pub struct View {
    pub index: Index,
    pub game: Arc<Game>,
}

fn apply(target: &mut Index, entries: &Entries) {
    for (k, v) in entries {
        match v {
            Some(e) => {
                target.insert(k.clone(), e.clone());
            }
            None => {
                target.shift_remove(k);
            }
        }
    }
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

fn find_case_insensitive(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut cur = root.to_path_buf();
    for part in rel.split('/') {
        let want = part.to_lowercase();
        let hit = fs::read_dir(&cur).ok()?.flatten().find(|e| e.file_name().to_string_lossy().to_lowercase() == want)?;
        cur = cur.join(hit.file_name());
    }
    Some(cur)
}

fn mega_files(xml: &Path) -> Vec<String> {
    let text = latin1(&fs::read(xml).unwrap_or_default());
    let rx = regex::Regex::new(r"<File>\s*([^<]+?)\s*</File>").unwrap();
    rx.captures_iter(&text).map(|c| c[1].replace('\\', "/")).collect()
}

fn meg_list(root: &Path, language: usize) -> Vec<String> {
    let mut out = mega_files(&root.join("Data").join("megafiles.xml"));
    out.extend(["Data/Patch.meg", "Data/Patch2.meg", "Data/64Patch.meg"].map(String::from));
    for f in ["sfx2d_non_localized".to_string(), "sfx3d_non_localized".to_string(), format!("sfx2d_{}", language_name(language))] {
        out.push(format!("Data/Audio/SFX/{f}.meg"));
    }
    out
}

pub fn read_at(f: &File, buf: &mut [u8], off: u64) -> std::io::Result<()> {
    let mut done = 0;
    while done < buf.len() {
        #[cfg(windows)]
        let n = std::os::windows::fs::FileExt::seek_read(f, &mut buf[done..], off + done as u64)?;
        #[cfg(unix)]
        let n = std::os::unix::fs::FileExt::read_at(f, &mut buf[done..], off + done as u64)?;
        if n == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        done += n;
    }
    Ok(())
}

impl Files {
    fn open(&mut self, path: &Path) -> Option<usize> {
        if let Some(i) = self.paths.iter().position(|p| p == path) {
            return Some(i);
        }
        let f = File::open(path).ok()?;
        self.paths.push(path.to_path_buf());
        self.handles.push(Arc::new(f));
        Some(self.paths.len() - 1)
    }

    fn read_meg_index(&mut self, path: &Path) -> Entries {
        let mut entries = Entries::new();
        let Some(i) = self.open(path) else { return entries };
        let f = &self.handles[i];
        let mut head = [0u8; 8];
        if read_at(f, &mut head, 0).is_err() {
            return entries;
        }
        let n_names = u32::from_le_bytes(head[0..4].try_into().unwrap()) as usize;
        let n_files = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let mut buf = vec![0u8; len.min((64 + n_names * 300 + n_files * 20) as u64) as usize];
        if read_at(f, &mut buf, 0).is_err() {
            return entries;
        }
        let u16at = |p: usize| buf.get(p..p + 2).map(|b| u16::from_le_bytes(b.try_into().unwrap()) as usize);
        let u32at = |p: usize| buf.get(p..p + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()));
        let mut p = 8;
        let mut names = Vec::with_capacity(n_names);
        for _ in 0..n_names {
            let Some(l) = u16at(p) else { return entries };
            p += 2;
            let Some(s) = buf.get(p..p + l) else { return entries };
            names.push(latin1(s));
            p += l;
        }
        for _ in 0..n_files {
            let (Some(size), Some(off), Some(name)) = (u32at(p + 8), u32at(p + 12), u32at(p + 16)) else { break };
            if let Some(n) = names.get(name as usize) {
                entries.insert(n.to_uppercase(), Some(Entry { src: Src::Meg(i), off: Some(off as u64), size: size as u64 }));
            }
            p += 20;
        }
        entries
    }
}

fn index_loose(root: &Path, dir: &str, entries: &mut Entries) {
    let Ok(list) = fs::read_dir(root.join(dir)) else { return };
    for e in list.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let rel = format!("{dir}/{name}");
        let Ok(t) = e.file_type() else { continue };
        if t.is_dir() {
            index_loose(root, &rel, entries);
        } else if !name.to_lowercase().ends_with(".meg") {
            let file = root.join(&rel);
            let size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            let key = rel.replace('/', "\\").to_uppercase();
            entries.insert(key, (size > 0).then(|| Entry { src: Src::File(Arc::new(file)), off: None, size }));
        }
    }
}

fn be16(d: &[u8], p: usize) -> Option<usize> {
    d.get(p..p + 2).map(|b| u16::from_be_bytes(b.try_into().unwrap()) as usize)
}
fn be32(d: &[u8], p: usize) -> Option<usize> {
    d.get(p..p + 4).map(|b| u32::from_be_bytes(b.try_into().unwrap()) as usize)
}

fn embedded_fonts(d: &[u8]) -> Vec<(String, usize, usize)> {
    let mut out = vec![];
    let mut i = 0;
    while let Some(at) = d.get(i..).and_then(|s| s.windows(4).position(|w| w == [0, 1, 0, 0])) {
        let start = i + at;
        i = start + 4;
        let Some(n) = be16(d, start + 4) else { break };
        if !(8..=40).contains(&n) || start + 12 + n * 16 > d.len() {
            continue;
        }
        let (mut end, mut name_at, mut ok) = (0, 0, true);
        for k in 0..n {
            let o = start + 12 + k * 16;
            let tag = &d[o..o + 4];
            let (off, len) = (be32(d, o + 8).unwrap(), be32(d, o + 12).unwrap());
            if !tag.iter().all(|&c| (b' '..=b'~').contains(&c)) || start + off + len > d.len() {
                ok = false;
                break;
            }
            if tag == b"name" {
                name_at = start + off;
            }
            end = end.max(off + len);
        }
        if !ok || name_at == 0 {
            continue;
        }
        let mut ps = String::new();
        let (Some(count), Some(strings)) = (be16(d, name_at + 2), be16(d, name_at + 4)) else { continue };
        let strings = name_at + strings;
        for k in 0..count {
            if !ps.is_empty() {
                break;
            }
            let o = name_at + 6 + k * 12;
            if be16(d, o + 6) != Some(6) {
                continue;
            }
            let (Some(platform), Some(len), Some(off)) = (be16(d, o), be16(d, o + 8), be16(d, o + 10)) else { continue };
            let raw = d.get(strings + off..strings + off + len).unwrap_or_default();
            ps = if platform == 1 { latin1(raw) } else { latin1(raw).replace('\0', "") };
        }
        let good = ps.strip_prefix("EmpireAtWar-").is_some_and(|r| !r.is_empty() && r.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'));
        if good {
            out.push((ps, start, end));
        }
    }
    out
}

impl Game {
    pub fn open(game_dir: &Path, mods: &[PathBuf], language: usize, expansion: bool) -> Arc<View> {
        let mut files = Files::default();
        let mut layers = vec![];
        let mut index = Index::new();
        let mount = |layers: &mut Vec<Layer>, index: &mut Index, root: Option<PathBuf>, entries: Entries| {
            apply(index, &entries);
            layers.push(Layer { root, entries });
        };
        let mut roots = vec![game_dir.join("GameData")];
        if expansion {
            roots.push(game_dir.join("corruption"));
        }
        for root in roots {
            if !root.join("Data").join("megafiles.xml").exists() {
                continue;
            }
            let archives = meg_list(&root, language);
            for (position, rel) in archives.iter().enumerate() {
                let f = find_case_insensitive(&root, rel);
                if position == archives.len() - 1 {
                    let entries = f.map(|f| files.read_meg_index(&f)).unwrap_or_default();
                    mount(&mut layers, &mut index, Some(root.clone()), entries);
                } else if let Some(f) = f {
                    let entries = files.read_meg_index(&f);
                    mount(&mut layers, &mut index, None, entries);
                }
            }
            let mut loose = Entries::new();
            index_loose(&root, "Data", &mut loose);
            mount(&mut layers, &mut index, None, loose);
        }
        for root in mods {
            if let Some(list) = find_case_insensitive(root, "Data/megafiles.xml") {
                for rel in mega_files(&list) {
                    if let Some(f) = find_case_insensitive(root, &rel) {
                        if !files.paths.contains(&f) {
                            let entries = files.read_meg_index(&f);
                            mount(&mut layers, &mut index, None, entries);
                        }
                    }
                }
            }
            let data = find_case_insensitive(root, "Data").and_then(|d| d.file_name().map(|n| n.to_string_lossy().into_owned())).unwrap_or("Data".into());
            let mut loose = Entries::new();
            index_loose(root, &data, &mut loose);
            mount(&mut layers, &mut index, None, loose);
        }

        for root in if expansion { vec!["corruption", "GameData"] } else { vec!["GameData"] } {
            let Some(exe) = find_case_insensitive(game_dir, &format!("{root}/StarWarsG.exe")) else { continue };
            let d = fs::read(&exe).unwrap_or_default();
            let exe = Arc::new(exe);
            for (ps, off, size) in embedded_fonts(&d) {
                let e = Entry { src: Src::File(exe.clone()), off: Some(off as u64), size: size as u64 };
                let key = format!("Data\\Fonts\\{ps}.ttf").to_uppercase();
                if !index.contains_key(&key) {
                    index.insert(key, e.clone());
                }
                index.insert(format!("Data\\Fonts\\Game\\{ps}.ttf").to_uppercase(), e);
            }
            break;
        }
        let fonts = index.iter().filter(|(k, e)| k.starts_with("DATA\\FONTS\\") && e.off.is_some() && e.file().is_some()).map(|(k, e)| (k.clone(), e.clone())).collect();
        let game = Arc::new(Game { layers, fonts, files: Mutex::new(files), languages: Mutex::new(HashMap::new()) });
        let view = Arc::new(View { index, game: game.clone() });
        game.languages.lock().unwrap().insert(language, view.clone());
        view
    }

    pub fn for_language(self: &Arc<Self>, id: usize) -> Arc<View> {
        if let Some(v) = self.languages.lock().unwrap().get(&id) {
            return v.clone();
        }
        let mut selected = Index::new();
        for layer in &self.layers {
            match &layer.root {
                None => apply(&mut selected, &layer.entries),
                Some(root) => {
                    if let Some(f) = find_case_insensitive(root, &format!("Data/Audio/SFX/sfx2d_{}.meg", language_name(id))) {
                        let entries = self.files.lock().unwrap().read_meg_index(&f);
                        apply(&mut selected, &entries);
                    }
                }
            }
        }
        for (k, f) in &self.fonts {
            if !selected.contains_key(k) {
                selected.insert(k.clone(), f.clone());
            }
        }
        let view = Arc::new(View { index: selected, game: self.clone() });
        self.languages.lock().unwrap().entry(id).or_insert(view).clone()
    }
}

impl View {
    pub fn resolve(&self, key: &str) -> Option<String> {
        let key = key.replace('/', "\\").to_uppercase();
        if self.index.contains_key(&key) {
            return Some(key);
        }
        if let Some(base) = key.strip_suffix(".TGA") {
            let dds = format!("{base}.DDS");
            if self.index.contains_key(&dds) {
                return Some(dds);
            }
        }
        None
    }

    pub fn read(&self, key: &str) -> Option<Vec<u8>> {
        let e = self.index.get(key)?;
        match (&e.src, e.off) {
            (Src::File(f), None) => fs::read(f.as_path()).ok(),
            _ => self.read_part(key, 0, e.size),
        }
    }

    pub fn size(&self, key: &str) -> Option<u64> {
        self.index.get(key).map(|e| e.size)
    }

    pub fn read_part(&self, key: &str, start: u64, len: u64) -> Option<Vec<u8>> {
        let e = self.index.get(key)?;
        let len = len.min(e.size.saturating_sub(start));
        let mut b = vec![0; len as usize];
        let at = e.off.unwrap_or(0) + start;
        match &e.src {
            Src::File(f) => read_at(&File::open(f.as_path()).ok()?, &mut b, at).ok()?,
            Src::Meg(i) => {
                let h = self.game.files.lock().unwrap().handles[*i].clone();
                read_at(&h, &mut b, at).ok()?
            }
        }
        Some(b)
    }
}

pub fn range_of(header: Option<&str>, size: u64) -> Option<Result<(u64, u64), ()>> {
    let r = header?.trim().strip_prefix("bytes=")?;
    let (a, b) = r.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    if a.is_empty() && b.is_empty() || r.contains(',') {
        return None;
    }
    let num = |s: &str| s.parse::<u64>().ok();
    let (from, to) = match (num(a), num(b)) {
        (Some(x), Some(y)) => (x, y.min(size.saturating_sub(1))),
        (Some(x), None) if b.is_empty() => (x, size.saturating_sub(1)),
        (None, Some(n)) if a.is_empty() => (size.saturating_sub(n), size.saturating_sub(1)),
        _ => return None,
    };
    Some(if size == 0 || from > to || from >= size { Err(()) } else { Ok((from, to)) })
}
