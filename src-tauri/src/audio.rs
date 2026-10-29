#[cfg(windows)]
pub fn name_sessions(name: &'static str) {
    std::thread::spawn(move || {
        if let Err(e) = unsafe { watch(name) } {
            eprintln!("audio sessions: {e}");
        }
    });
}

#[cfg(not(windows))]
pub fn name_sessions(_name: &'static str) {}

#[cfg(windows)]
unsafe fn watch(name: &str) -> windows::core::Result<()> {
    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
    let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let exe = std::env::current_exe()
        .map(|p| format!("{},0", p.display()))
        .unwrap_or_default();
    let (title, icon) = (HSTRING::from(name), HSTRING::from(exe));
    loop {
        if let Ok(device) = devices.GetDefaultAudioEndpoint(eRender, eConsole) {
            if let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) {
                if let Ok(list) = manager.GetSessionEnumerator() {
                    let ours = descendants(std::process::id());
                    for i in 0..list.GetCount().unwrap_or(0) {
                        let Ok(s) = list.GetSession(i) else { continue };
                        let Ok(s2) = s.cast::<IAudioSessionControl2>() else {
                            continue;
                        };
                        let Ok(pid) = s2.GetProcessId() else { continue };
                        if !ours.contains(&pid) {
                            continue;
                        }
                        let named = s
                            .GetDisplayName()
                            .map(|p| {
                                let v = p.to_string().unwrap_or_default();
                                CoTaskMemFree(Some(p.0 as _));
                                v
                            })
                            .unwrap_or_default();
                        if named != name {
                            let set = s.SetDisplayName(PCWSTR(title.as_ptr()), std::ptr::null());
                            let _ = s.SetIconPath(PCWSTR(icon.as_ptr()), std::ptr::null());
                            if std::env::var_os("SWR_AUDIO_LOG").is_some() {
                                let now = s
                                    .GetDisplayName()
                                    .map(|p| {
                                        let v = p.to_string().unwrap_or_default();
                                        CoTaskMemFree(Some(p.0 as _));
                                        v
                                    })
                                    .unwrap_or_default();
                                eprintln!("audio session of process {pid}: was {named:?}, set {set:?}, now {now:?}");
                            }
                        }
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
}

#[cfg(windows)]
fn descendants(root: u32) -> Vec<u32> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::*;
    let mut pairs = vec![];
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return vec![];
        };
        let mut e = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                pairs.push((e.th32ProcessID, e.th32ParentProcessID));
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        let p = out[i];
        for &(c, parent) in &pairs {
            if parent == p && c != p && !out.contains(&c) {
                out.push(c);
            }
        }
        i += 1;
    }
    out
}
