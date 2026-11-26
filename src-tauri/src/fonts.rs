use crate::vfs::View;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

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

struct Started {
    directory: PathBuf,
    alias: HashMap<String, Option<String>>,
    /// Held while a page renders; true once the game's fonts are registered with GDI.
    registered: Mutex<bool>,
    fonts: Vec<Vec<u8>>,
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
                Ok(Started {
                    directory,
                    alias,
                    registered: Mutex::new(false),
                    fonts,
                })
            })
            .as_ref()
            .map_err(|e| e.clone())
    }

    pub fn asset(&self, name: &str) -> Result<Option<Vec<u8>>, String> {
        // the fonts are drawn by Windows' own GDI, as the game draws them; elsewhere the page
        // draws them itself, as it does in a browser
        if !cfg!(windows) {
            return Ok(None);
        }
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
        let mut registered = started.registered.lock().unwrap();
        if let Ok(b) = std::fs::read(&file) {
            return Ok(Some(b));
        }
        if !*registered {
            for font in &started.fonts {
                gdi::add(font)?;
            }
            *registered = true;
        }
        let asked = started
            .alias
            .get(&face.to_uppercase())
            .cloned()
            .flatten()
            .unwrap_or(face.clone());
        let atlas = gdi::render(
            &asked,
            height as i32,
            stretch as f32,
            page as u32,
            bold,
            charset as u8,
        )?;
        let mut gz = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
        gz.write_all(&atlas.mask).map_err(|e| e.to_string())?;
        let mask = gz.finish().map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD;
        let value = serde_json::json!({
            "height": atlas.height,
            "ascent": atlas.ascent,
            "average": atlas.average,
            "page": page as u32,
            "weight": atlas.weight,
            "charset": charset as u32,
            "face": atlas.face,
            "mask": b64.encode(mask),
            "widths": atlas.widths,
            "offsets": atlas.offsets,
            "compression": "gzip",
        });
        let bytes = serde_json::to_vec(&value).unwrap();
        let _ = std::fs::write(&file, &bytes);
        Ok(Some(bytes))
    }
}

/// One code page of a font drawn by GDI: each glyph's width and its coverage rows, glyph after glyph.
struct Atlas {
    height: i32,
    ascent: i32,
    average: i32,
    weight: i32,
    face: String,
    widths: Vec<i32>,
    offsets: Vec<i32>,
    mask: Vec<u8>,
}

#[cfg(windows)]
mod gdi {
    use super::Atlas;
    use windows::Win32::Foundation::{COLORREF, RECT, SIZE};
    use windows::Win32::Graphics::Gdi::*;
    use windows::core::{HSTRING, PCWSTR};

    /// Makes a font file visible to this process only, as the game does with its own fonts.
    pub fn add(data: &[u8]) -> Result<(), String> {
        let mut count = 0u32;
        let handle = unsafe {
            AddFontMemResourceEx(
                data.as_ptr().cast(),
                data.len() as u32,
                None,
                &raw mut count,
            )
        };
        if handle.is_invalid() {
            return Err("Cannot register font".into());
        }
        Ok(())
    }

    /// Releases the bitmap, font and device context in the reverse order they were selected.
    struct Dc {
        dc: HDC,
        font: HFONT,
        old_font: HGDIOBJ,
        bitmap: HBITMAP,
        old_bitmap: HGDIOBJ,
    }

    impl Dc {
        fn select_font(&mut self, font: HFONT) {
            unsafe {
                let old = SelectObject(self.dc, font.into());
                if self.old_font.is_invalid() {
                    self.old_font = old;
                }
                if !self.font.is_invalid() {
                    let _ = DeleteObject(self.font.into());
                }
            }
            self.font = font;
        }

        fn face(&self) -> String {
            let mut name = [0u16; 256];
            unsafe { GetTextFaceW(self.dc, Some(&mut name)) };
            let end = name.iter().position(|&c| c == 0).unwrap_or(name.len());
            String::from_utf16_lossy(&name[..end])
        }

        fn metrics(&self) -> TEXTMETRICW {
            let mut tm = TEXTMETRICW::default();
            unsafe {
                let _ = GetTextMetricsW(self.dc, &mut tm);
            }
            tm
        }
    }

    impl Drop for Dc {
        fn drop(&mut self) {
            unsafe {
                if !self.old_bitmap.is_invalid() {
                    SelectObject(self.dc, self.old_bitmap);
                }
                if !self.bitmap.is_invalid() {
                    let _ = DeleteObject(self.bitmap.into());
                }
                if !self.old_font.is_invalid() {
                    SelectObject(self.dc, self.old_font);
                }
                if !self.font.is_invalid() {
                    let _ = DeleteObject(self.font.into());
                }
                let _ = DeleteDC(self.dc);
            }
        }
    }

    fn font(height: i32, width: i32, face: &str, bold: bool, charset: u8) -> Result<HFONT, String> {
        let font = unsafe {
            CreateFontW(
                height,
                width,
                0,
                0,
                if bold { 700 } else { 400 },
                0,
                0,
                0,
                FONT_CHARSET(charset),
                FONT_OUTPUT_PRECISION(0),
                FONT_CLIP_PRECISION(0),
                ANTIALIASED_QUALITY,
                VARIABLE_PITCH.0 as u32,
                &HSTRING::from(face),
            )
        };
        if font.is_invalid() {
            return Err(format!("CreateFont failed: {face}"));
        }
        Ok(font)
    }

    pub fn render(
        face: &str,
        height: i32,
        stretch: f32,
        page: u32,
        bold: bool,
        charset: u8,
    ) -> Result<Atlas, String> {
        let mut dc = Dc {
            dc: unsafe { CreateCompatibleDC(None) },
            font: HFONT::default(),
            old_font: HGDIOBJ::default(),
            bitmap: HBITMAP::default(),
            old_bitmap: HGDIOBJ::default(),
        };
        if dc.dc.is_invalid() {
            return Err("CreateCompatibleDC failed".into());
        }
        let mut face = face.to_string();
        dc.select_font(font(-height, 0, &face, bold, charset)?);
        // a face GDI does not know falls back to Arial
        if !dc.face().eq_ignore_ascii_case(&face) && face != "Arial" {
            face = "Arial".into();
            dc.select_font(font(-height, 0, &face, bold, charset)?);
        }
        let mut tm = dc.metrics();
        if stretch >= 1.0001 || stretch <= 0.9999 {
            let stretched = (-(height as f32) * stretch + 0.5).floor() as i32;
            dc.select_font(font(stretched, tm.tmAveCharWidth, &face, bold, charset)?);
            tm = dc.metrics();
        }
        let rows = tm.tmHeight;
        let mut atlas = Atlas {
            height: rows,
            ascent: tm.tmAscent,
            average: tm.tmAveCharWidth,
            weight: tm.tmWeight,
            face: dc.face(),
            widths: vec![0; 256],
            offsets: vec![0; 256],
            mask: vec![],
        };
        let glyph = |i: usize| [(page * 256 + i as u32) as u16];
        let (mut widest, mut total) = (1i32, 0i32);
        for i in 0..256 {
            let mut size = SIZE::default();
            unsafe {
                let _ = GetTextExtentPoint32W(dc.dc, &glyph(i), &mut size);
            }
            atlas.widths[i] = size.cx;
            atlas.offsets[i] = total;
            total += size.cx * rows;
            widest = widest.max(size.cx);
        }
        let widest = widest.max((tm.tmMaxCharWidth + 3) & !3);
        if rows <= 0 || total < 0 {
            return Err(format!("{face} has no glyph rows"));
        }
        let stride = ((widest * 3 + 3) & !3) as usize;
        let bytes = stride * rows as usize;
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: widest,
                biHeight: -rows,
                biPlanes: 1,
                biBitCount: 24,
                biSizeImage: bytes as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        dc.bitmap =
            unsafe { CreateDIBSection(Some(dc.dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) }
                .map_err(|e| e.to_string())?;
        if bits.is_null() {
            return Err("CreateDIBSection gave no pixels".into());
        }
        unsafe {
            dc.old_bitmap = SelectObject(dc.dc, dc.bitmap.into());
            SetTextColor(dc.dc, COLORREF(0xffffff));
            SetBkColor(dc.dc, COLORREF(0));
        }
        let pixels = bits as *mut u8;
        let mut mask = vec![0u8; total as usize];
        for i in 0..256 {
            let w = atlas.widths[i];
            unsafe { std::ptr::write_bytes(pixels, 0, bytes) };
            if w == 0 {
                continue;
            }
            let rect = RECT {
                left: 0,
                top: 0,
                right: w - 1,
                bottom: rows - 1,
            };
            let text = glyph(i);
            let dib = unsafe {
                let _ = ExtTextOutW(
                    dc.dc,
                    0,
                    0,
                    ETO_OPAQUE,
                    Some(&rect),
                    PCWSTR(text.as_ptr()),
                    1,
                    None,
                );
                let _ = GdiFlush();
                std::slice::from_raw_parts(pixels, bytes)
            };
            let (w, at) = (w as usize, atlas.offsets[i] as usize);
            for y in 0..rows as usize {
                for x in 0..w {
                    mask[at + y * w + x] = dib[y * stride + x * 3];
                }
            }
        }
        atlas.mask = mask;
        Ok(atlas)
    }
}

#[cfg(not(windows))]
mod gdi {
    use super::Atlas;

    pub fn add(_data: &[u8]) -> Result<(), String> {
        Err("game fonts are drawn with Windows GDI".into())
    }

    pub fn render(
        _face: &str,
        _height: i32,
        _stretch: f32,
        _page: u32,
        _bold: bool,
        _charset: u8,
    ) -> Result<Atlas, String> {
        Err("game fonts are drawn with Windows GDI".into())
    }
}
