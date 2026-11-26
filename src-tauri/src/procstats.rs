//! CPU, memory, GPU and I/O use of the app's own processes: this executable and the WebView2 processes it
//! started (browser, GPU, renderer, utility). Read-only queries that need no elevation; the benchmark overlay
//! and the bug report ask about once a second, and every figure is a rate over the time since the last ask.
use std::collections::HashMap;
use std::time::Duration;

/// Asked again sooner than this, the last answer is given: a rate over a few milliseconds is noise.
#[cfg(windows)]
const SHORTEST: Duration = Duration::from_millis(250);
/// After this long without a question the old counters say nothing about now: measure a fresh interval.
#[cfg(windows)]
const STALE: Duration = Duration::from_secs(5);
#[cfg(windows)]
const FIRST_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Proc {
    pub pid: u32,
    pub parent: u32,
}

/// The root and everything it started, directly or not. Windows reuses process ids and never clears the
/// parent id of an orphan, so a "child" created before its parent is somebody else's process: `created`
/// (any monotonic stamp, None when unknown) drops those and what hangs below them.
pub fn tree(root: u32, procs: &[Proc], created: impl Fn(u32) -> Option<u64>) -> Vec<u32> {
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        let parent = out[i];
        for p in procs {
            if p.parent != parent || p.pid == parent || p.pid == 0 || out.contains(&p.pid) {
                continue;
            }
            if let (Some(child), Some(of)) = (created(p.pid), created(parent)) {
                if child < of {
                    continue;
                }
            }
            out.push(p.pid);
        }
        i += 1;
    }
    out
}

/// Share of the whole machine (all logical processors) that `after - before` of CPU time, counted in
/// 100 ns units as Windows does, is over `elapsed`: what Task Manager's CPU column shows.
pub fn cpu_percent(before: u64, after: u64, elapsed: Duration, processors: u32) -> f64 {
    let wall = elapsed.as_secs_f64() * processors.max(1) as f64;
    if wall <= 0.0 {
        return 0.0;
    }
    let busy = after.saturating_sub(before) as f64 / 1e7;
    (busy / wall * 100.0).clamp(0.0, 100.0)
}

/// A counter that only grows, as a rate per second.
pub fn per_second(before: u64, after: u64, elapsed: Duration) -> f64 {
    let secs = elapsed.as_secs_f64();
    if secs <= 0.0 {
        return 0.0;
    }
    after.saturating_sub(before) as f64 / secs
}

/// "pid_4242_luid_0x00000000_0x0000D4B5_phys_0_eng_3_engtype_VideoDecode" is process 4242 on a video
/// decode engine; the "GPU Process Memory" instances stop after "phys_0" and have no engine.
pub fn gpu_instance(name: &str) -> Option<(u32, Option<&str>)> {
    let rest = name.strip_prefix("pid_")?;
    let digits = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    let pid = rest[..digits].parse().ok()?;
    let engine = rest.split_once("_engtype_").map(|(_, e)| e);
    Some((pid, engine))
}

#[derive(Clone, Debug, PartialEq)]
pub struct GpuUse {
    pub percent: f64,
    pub engine: String,
}

/// GPU use per process from the "GPU Engine" counter instances: an engine type's nodes add up, and a
/// process (like the total over `pids`) is as busy as its busiest engine type, as in Task Manager.
pub fn gpu_use(items: &[(String, f64)], pids: &[u32]) -> (HashMap<u32, GpuUse>, Option<GpuUse>) {
    let mut each: HashMap<u32, HashMap<&str, f64>> = HashMap::new();
    let mut all: HashMap<&str, f64> = HashMap::new();
    for (name, value) in items {
        let Some((pid, Some(engine))) = gpu_instance(name) else {
            continue;
        };
        if !pids.contains(&pid) || !value.is_finite() {
            continue;
        }
        *each.entry(pid).or_default().entry(engine).or_default() += value.max(0.0);
        *all.entry(engine).or_default() += value.max(0.0);
    }
    let busiest = |engines: &HashMap<&str, f64>| {
        let mut list: Vec<_> = engines.iter().collect();
        // by use, then by name so equal figures always name the same engine
        list.sort_by(|a, b| b.1.total_cmp(a.1).then(a.0.cmp(b.0)));
        list.first().map(|(engine, percent)| GpuUse {
            percent: percent.min(100.0),
            engine: engine.to_string(),
        })
    };
    let per = each
        .iter()
        .filter_map(|(pid, engines)| Some((*pid, busiest(engines)?)))
        .collect();
    (per, busiest(&all))
}

/// Bytes per process from the "GPU Process Memory" counter instances (one per adapter a process uses).
pub fn gpu_memory(items: &[(String, f64)], pids: &[u32]) -> HashMap<u32, f64> {
    let mut out = HashMap::new();
    for (name, value) in items {
        if let Some((pid, _)) = gpu_instance(name) {
            if pids.contains(&pid) && value.is_finite() {
                *out.entry(pid).or_default() += value.max(0.0);
            }
        }
    }
    out
}

/// What a process of the app is for: WebView2 (Chromium) says so on each child's command line.
pub fn process_kind(exe: &str, command_line: &str, root: bool) -> String {
    if root {
        return "app".into();
    }
    let arg = |name: &str| {
        command_line
            .split_whitespace()
            .find_map(|a| a.trim_matches('"').strip_prefix(name))
    };
    match arg("--type=") {
        Some("gpu-process") => "gpu".into(),
        Some("crashpad-handler") => "crash handler".into(),
        Some("utility") => match arg("--utility-sub-type=") {
            // network.mojom.NetworkService -> utility (network)
            Some(sub) => {
                let last = sub.rsplit('.').next().unwrap_or(sub);
                let short = last.strip_suffix("Service").unwrap_or(last);
                format!("utility ({})", short.to_lowercase())
            }
            None => "utility".into(),
        },
        Some(other) => other.to_string(),
        None => {
            let lower = exe.to_lowercase();
            if lower.starts_with("msedgewebview2") {
                "browser".into()
            } else {
                lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
            }
        }
    }
}

#[cfg(not(windows))]
pub fn stats() -> serde_json::Value {
    serde_json::json!({ "supported": false, "why": "process figures are read on Windows only" })
}

#[cfg(windows)]
pub fn stats() -> serde_json::Value {
    win::stats()
}

#[cfg(windows)]
mod win {
    use super::*;
    use serde_json::{Value, json};
    use std::sync::Mutex;
    use std::time::Instant;
    use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
    use windows::Win32::System::Diagnostics::ToolHelp::*;
    use windows::Win32::System::Performance::*;
    use windows::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows::Win32::System::Threading::{
        GetProcessIoCounters, GetProcessTimes, IO_COUNTERS, OpenProcess,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::{HSTRING, PCWSTR};

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtQueryInformationProcess(
            process: HANDLE,
            class: u32,
            info: *mut core::ffi::c_void,
            len: u32,
            returned: *mut u32,
        ) -> i32;
    }
    const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;

    struct Open(HANDLE);
    impl Drop for Open {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    /// The running totals Windows keeps for one process.
    struct Raw {
        created: u64,
        cpu: u64,
        working_set: u64,
        private: u64,
        read: u64,
        write: u64,
        other: u64,
    }

    fn ticks(t: FILETIME) -> u64 {
        ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
    }

    fn listed() -> Vec<(Proc, String)> {
        let mut out = vec![];
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return out;
            };
            let mut e = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snap, &mut e).is_ok() {
                loop {
                    let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(0);
                    out.push((
                        Proc {
                            pid: e.th32ProcessID,
                            parent: e.th32ParentProcessID,
                        },
                        String::from_utf16_lossy(&e.szExeFile[..len]),
                    ));
                    if Process32NextW(snap, &mut e).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        out
    }

    fn open(pid: u32) -> Option<Open> {
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
            .ok()
            .map(Open)
    }

    fn raw(h: &Open) -> Option<Raw> {
        unsafe {
            let (mut created, mut exited, mut kernel, mut user) = Default::default();
            GetProcessTimes(h.0, &mut created, &mut exited, &mut kernel, &mut user).ok()?;
            let mut mem = PROCESS_MEMORY_COUNTERS_EX {
                cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
                ..Default::default()
            };
            let mem_ok = K32GetProcessMemoryInfo(
                h.0,
                &mut mem as *mut _ as *mut PROCESS_MEMORY_COUNTERS,
                mem.cb,
            )
            .as_bool();
            let mut io = IO_COUNTERS::default();
            let _ = GetProcessIoCounters(h.0, &mut io);
            Some(Raw {
                created: ticks(created),
                cpu: ticks(kernel) + ticks(user),
                working_set: if mem_ok { mem.WorkingSetSize as u64 } else { 0 },
                private: if mem_ok { mem.PrivateUsage as u64 } else { 0 },
                read: io.ReadTransferCount,
                write: io.WriteTransferCount,
                other: io.OtherTransferCount,
            })
        }
    }

    fn command_line(h: &Open) -> String {
        #[repr(C)]
        struct UnicodeString {
            len: u16,
            max: u16,
            text: *const u16,
        }
        let mut buf = vec![0u64; 1024];
        for _ in 0..2 {
            let bytes = buf.len() * 8;
            let mut need = 0u32;
            let status = unsafe {
                NtQueryInformationProcess(
                    h.0,
                    PROCESS_COMMAND_LINE_INFORMATION,
                    buf.as_mut_ptr().cast(),
                    bytes as u32,
                    &mut need,
                )
            };
            if status >= 0 {
                let s = unsafe { &*(buf.as_ptr() as *const UnicodeString) };
                let (base, at) = (buf.as_ptr() as usize, s.text as usize);
                if s.text.is_null() || at < base || at + s.len as usize > base + bytes {
                    return String::new();
                }
                let text = unsafe { std::slice::from_raw_parts(s.text, s.len as usize / 2) };
                return String::from_utf16_lossy(text);
            }
            if need as usize <= bytes {
                break;
            }
            buf = vec![0u64; need as usize / 8 + 1];
        }
        String::new()
    }

    /// The performance counters Task Manager's GPU columns come from (Windows 10 1709 and later).
    struct Gpu {
        query: PDH_HQUERY,
        engine: Option<PDH_HCOUNTER>,
        dedicated: Option<PDH_HCOUNTER>,
        shared: Option<PDH_HCOUNTER>,
        // the processes the query was opened for: a new one reopens it so its instances are counted
        pids: Vec<u32>,
    }
    unsafe impl Send for Gpu {}

    impl Gpu {
        fn open(pids: &[u32]) -> Option<Gpu> {
            unsafe {
                let mut query = PDH_HQUERY::default();
                if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                    return None;
                }
                let add = |path: &str| {
                    let path = HSTRING::from(path);
                    let mut counter = PDH_HCOUNTER::default();
                    (PdhAddEnglishCounterW(query, PCWSTR(path.as_ptr()), 0, &mut counter) == 0)
                        .then_some(counter)
                };
                let gpu = Gpu {
                    query,
                    engine: add(r"\GPU Engine(pid_*)\Utilization Percentage"),
                    dedicated: add(r"\GPU Process Memory(pid_*)\Dedicated Usage"),
                    shared: add(r"\GPU Process Memory(pid_*)\Shared Usage"),
                    pids: pids.to_vec(),
                };
                if gpu.engine.is_none() && gpu.dedicated.is_none() && gpu.shared.is_none() {
                    return None;
                }
                PdhCollectQueryData(query);
                Some(gpu)
            }
        }

        fn values(counter: Option<PDH_HCOUNTER>) -> Vec<(String, f64)> {
            let Some(counter) = counter else {
                return vec![];
            };
            unsafe {
                for _ in 0..3 {
                    let (mut size, mut count) = (0u32, 0u32);
                    let status = PdhGetFormattedCounterArrayW(
                        counter,
                        PDH_FMT_DOUBLE,
                        &mut size,
                        &mut count,
                        None,
                    );
                    if status != PDH_MORE_DATA || size == 0 {
                        return vec![];
                    }
                    let mut buf = vec![0u64; size as usize / 8 + 1];
                    let status = PdhGetFormattedCounterArrayW(
                        counter,
                        PDH_FMT_DOUBLE,
                        &mut size,
                        &mut count,
                        Some(buf.as_mut_ptr().cast()),
                    );
                    if status == PDH_MORE_DATA {
                        continue;
                    }
                    if status != 0 {
                        return vec![];
                    }
                    let items = std::slice::from_raw_parts(
                        buf.as_ptr() as *const PDH_FMT_COUNTERVALUE_ITEM_W,
                        count as usize,
                    );
                    return items
                        .iter()
                        // 0 is valid data, 1 new data
                        .filter(|item| item.FmtValue.CStatus <= 1 && !item.szName.is_null())
                        .filter_map(|item| {
                            let name = item.szName.to_string().ok()?;
                            Some((name, item.FmtValue.Anonymous.doubleValue))
                        })
                        .collect();
                }
                vec![]
            }
        }
    }

    impl Drop for Gpu {
        fn drop(&mut self) {
            unsafe {
                PdhCloseQuery(self.query);
            }
        }
    }

    #[derive(Default)]
    struct Sampler {
        at: Option<Instant>,
        seen: HashMap<u32, Raw>,
        kinds: HashMap<(u32, u64), String>,
        gpu: Option<Gpu>,
        gpu_missing: bool,
        last: Option<Value>,
    }

    impl Sampler {
        fn read(&mut self) -> Value {
            let now = Instant::now();
            let elapsed = self.at.map(|at| now - at);
            let root = std::process::id();
            let list = listed();
            let procs: Vec<Proc> = list.iter().map(|(p, _)| *p).collect();
            let mut handles = HashMap::new();
            let mut raws = HashMap::new();
            let mut unreadable = 0;
            for pid in tree(root, &procs, |_| None) {
                match open(pid).and_then(|h| Some((raw(&h)?, h))) {
                    Some((r, h)) => {
                        raws.insert(pid, r);
                        handles.insert(pid, h);
                    }
                    None => unreadable += 1,
                }
            }
            let pids: Vec<u32> = tree(root, &procs, |pid| raws.get(&pid).map(|r| r.created))
                .into_iter()
                .filter(|pid| raws.contains_key(pid))
                .collect();

            if !self.gpu_missing {
                let stale = match &self.gpu {
                    Some(gpu) => pids.iter().any(|pid| !gpu.pids.contains(pid)),
                    None => true,
                };
                if stale {
                    self.gpu = Gpu::open(&pids);
                    self.gpu_missing = self.gpu.is_none();
                } else if let Some(gpu) = &self.gpu {
                    unsafe {
                        PdhCollectQueryData(gpu.query);
                    }
                }
            }
            let (engines, dedicated, shared) = match &self.gpu {
                Some(gpu) => (
                    Gpu::values(gpu.engine),
                    Gpu::values(gpu.dedicated),
                    Gpu::values(gpu.shared),
                ),
                None => (vec![], vec![], vec![]),
            };
            let has_engines = !engines.is_empty();
            let has_memory = !dedicated.is_empty() || !shared.is_empty();
            let (gpu_each, gpu_all) = gpu_use(&engines, &pids);
            let (dedicated, shared) = (gpu_memory(&dedicated, &pids), gpu_memory(&shared, &pids));

            let processors = std::thread::available_parallelism()
                .map(|n| n.get() as u32)
                .unwrap_or(1);
            let mut rows = vec![];
            let (mut cpu_sum, mut rated) = (0.0, false);
            let (mut read_sum, mut write_sum, mut other_sum) = (0.0, 0.0, 0.0);
            let (mut working_sum, mut private_sum) = (0u64, 0u64);
            for &pid in &pids {
                let r = &raws[&pid];
                let exe = list
                    .iter()
                    .find(|(p, _)| p.pid == pid)
                    .map(|(_, name)| name.as_str())
                    .unwrap_or("");
                let kind = self.kinds.entry((pid, r.created)).or_insert_with(|| {
                    let line = if pid == root {
                        String::new()
                    } else {
                        command_line(&handles[&pid])
                    };
                    process_kind(exe, &line, pid == root)
                });
                // the same pid with another creation time is a different process: no rate across the two
                let before = self.seen.get(&pid).filter(|b| b.created == r.created);
                let rates = before.zip(elapsed).map(|(b, t)| {
                    (
                        cpu_percent(b.cpu, r.cpu, t, processors),
                        per_second(b.read, r.read, t),
                        per_second(b.write, r.write, t),
                        per_second(b.other, r.other, t),
                    )
                });
                if let Some((cpu, read, write, other)) = rates {
                    rated = true;
                    cpu_sum += cpu;
                    read_sum += read;
                    write_sum += write;
                    other_sum += other;
                }
                working_sum += r.working_set;
                private_sum += r.private;
                let gpu = gpu_each.get(&pid);
                rows.push(json!({
                    "pid": pid,
                    "name": exe,
                    "type": kind.as_str(),
                    "cpuPercent": rates.map(|r| round(r.0, 100.0)),
                    "workingSetBytes": r.working_set,
                    "privateBytes": r.private,
                    "gpuPercent": match gpu {
                        Some(g) => Some(round(g.percent, 100.0)),
                        None => has_engines.then_some(0.0),
                    },
                    "gpuEngine": gpu.map(|g| g.engine.as_str()),
                    "gpuDedicatedBytes": has_memory.then(|| dedicated.get(&pid).copied().unwrap_or(0.0).round()),
                    "gpuSharedBytes": has_memory.then(|| shared.get(&pid).copied().unwrap_or(0.0).round()),
                    "ioReadBytesPerSec": rates.map(|r| r.1.round()),
                    "ioWriteBytesPerSec": rates.map(|r| r.2.round()),
                    "ioOtherBytesPerSec": rates.map(|r| r.3.round()),
                }));
            }
            let total = json!({
                "processes": rows.len(),
                "cpuPercent": rated.then(|| round(cpu_sum.min(100.0), 100.0)),
                "workingSetBytes": working_sum,
                "privateBytes": private_sum,
                "gpuPercent": match &gpu_all {
                    Some(g) => Some(round(g.percent, 100.0)),
                    None => has_engines.then_some(0.0),
                },
                "gpuEngine": gpu_all.as_ref().map(|g| g.engine.as_str()),
                "gpuDedicatedBytes": has_memory.then(|| dedicated.values().sum::<f64>().round()),
                "gpuSharedBytes": has_memory.then(|| shared.values().sum::<f64>().round()),
                "ioReadBytesPerSec": rated.then(|| read_sum.round()),
                "ioWriteBytesPerSec": rated.then(|| write_sum.round()),
                "ioOtherBytesPerSec": rated.then(|| other_sum.round()),
            });
            self.kinds
                .retain(|(pid, created), _| raws.get(pid).is_some_and(|r| r.created == *created));
            self.seen = raws;
            self.at = Some(now);
            let out = json!({
                "supported": true,
                "intervalMs": elapsed.map(|t| t.as_millis() as u64),
                "logicalProcessors": processors,
                "gpuCounters": { "utilisation": has_engines, "memory": has_memory },
                "unreadable": unreadable,
                "processes": rows,
                "total": total,
            });
            self.last = Some(out.clone());
            out
        }
    }

    fn round(v: f64, by: f64) -> f64 {
        (v * by).round() / by
    }

    static SAMPLER: Mutex<Option<Sampler>> = Mutex::new(None);

    /// What the GPU counters say about every process on this machine: (engine instances, the busiest
    /// engine type over all of them, processes with GPU memory, dedicated bytes in all).
    #[cfg(test)]
    pub fn gpu_everywhere(wait: Duration) -> Option<(usize, Option<GpuUse>, usize, f64)> {
        let pids: Vec<u32> = listed().iter().map(|(p, _)| p.pid).collect();
        let gpu = Gpu::open(&pids)?;
        std::thread::sleep(wait);
        unsafe {
            PdhCollectQueryData(gpu.query);
        }
        let engines = Gpu::values(gpu.engine);
        let dedicated = gpu_memory(&Gpu::values(gpu.dedicated), &pids);
        let (_, all) = gpu_use(&engines, &pids);
        Some((
            engines.len(),
            all,
            dedicated.len(),
            dedicated.values().sum(),
        ))
    }

    pub fn stats() -> Value {
        let mut held = SAMPLER.lock().unwrap_or_else(|e| e.into_inner());
        let sampler = held.get_or_insert_with(Sampler::default);
        let age = sampler.at.map(|at| at.elapsed());
        match (age, &sampler.last) {
            (Some(age), Some(last)) if age < SHORTEST => return last.clone(),
            _ => {}
        }
        if age.is_none_or(|age| age > STALE) {
            sampler.read();
            std::thread::sleep(FIRST_INTERVAL);
        }
        sampler.read()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32) -> Proc {
        Proc { pid, parent }
    }

    #[test]
    fn tree_takes_the_app_and_its_descendants_only() {
        let procs = [
            p(0, 0),
            p(4, 0),
            p(100, 4),
            p(200, 100), // the app
            p(210, 200), // webview browser
            p(211, 210), // gpu
            p(212, 210), // renderer
            p(213, 212), // something a child started
            p(300, 100), // a sibling of the app
            p(301, 300),
        ];
        let mut got = tree(200, &procs, |_| None);
        got.sort();
        assert_eq!(got, vec![200, 210, 211, 212, 213]);
        assert_eq!(tree(999, &procs, |_| None), vec![999]);
    }

    #[test]
    fn tree_survives_loops_and_self_parents() {
        let procs = [p(1, 1), p(2, 1), p(1, 2), p(3, 3), p(0, 1)];
        let mut got = tree(1, &procs, |_| None);
        got.sort();
        assert_eq!(got, vec![1, 2]);
    }

    #[test]
    fn tree_drops_a_reused_parent_id() {
        // 500 names 200 as its parent but was created before the app: its real parent is gone and the
        // app only inherited the number; 501 hangs below it and goes too
        let procs = [
            p(200, 100),
            p(210, 200),
            p(500, 200),
            p(501, 500),
            p(220, 200),
        ];
        let created = |pid: u32| match pid {
            200 => Some(1000),
            210 => Some(1500),
            500 => Some(400),
            501 => Some(2000),
            _ => None, // 220 could not be opened: kept, since nothing says it is older
        };
        let mut got = tree(200, &procs, created);
        got.sort();
        assert_eq!(got, vec![200, 210, 220]);
    }

    #[test]
    fn cpu_is_a_share_of_all_processors() {
        let second = Duration::from_secs(1);
        // one second of CPU time in one second on one processor
        assert_eq!(cpu_percent(0, 10_000_000, second, 1), 100.0);
        // the same on eight processors is an eighth of the machine
        assert_eq!(cpu_percent(5, 10_000_005, second, 8), 12.5);
        // two busy threads over two seconds on four processors
        assert_eq!(cpu_percent(0, 40_000_000, Duration::from_secs(2), 4), 50.0);
        assert_eq!(
            cpu_percent(0, 90_000_000, second, 4),
            100.0,
            "never over the machine"
        );
        assert_eq!(
            cpu_percent(50, 10, second, 4),
            0.0,
            "a counter that went back"
        );
        assert_eq!(cpu_percent(0, 10, Duration::ZERO, 4), 0.0);
        assert_eq!(cpu_percent(0, 10_000_000, second, 0), 100.0);
    }

    #[test]
    fn byte_counters_become_rates() {
        assert_eq!(per_second(1000, 3000, Duration::from_secs(1)), 2000.0);
        assert_eq!(per_second(0, 3000, Duration::from_millis(500)), 6000.0);
        assert_eq!(per_second(0, 3000, Duration::from_secs(4)), 750.0);
        assert_eq!(per_second(3000, 1000, Duration::from_secs(1)), 0.0);
        assert_eq!(per_second(0, 3000, Duration::ZERO), 0.0);
    }

    #[test]
    fn gpu_instances_name_a_process_and_an_engine() {
        assert_eq!(
            gpu_instance("pid_4242_luid_0x00000000_0x0000D4B5_phys_0_eng_3_engtype_VideoDecode"),
            Some((4242, Some("VideoDecode")))
        );
        assert_eq!(
            gpu_instance("pid_7_luid_0x00000000_0x0000D4B5_phys_0"),
            Some((7, None))
        );
        assert_eq!(gpu_instance("luid_0x0_0x1_phys_0"), None);
        assert_eq!(gpu_instance("pid_x"), None);
    }

    #[test]
    fn gpu_use_is_the_busiest_engine_type() {
        let i = |pid: u32, eng: u32, kind: &str, v: f64| {
            (
                format!("pid_{pid}_luid_0x0_0x1_phys_0_eng_{eng}_engtype_{kind}"),
                v,
            )
        };
        let items = [
            i(10, 0, "3D", 30.0),
            i(10, 1, "3D", 12.5),
            i(10, 2, "VideoDecode", 40.0),
            i(11, 0, "3D", 20.0),
            i(11, 3, "Copy", 1.0),
            i(99, 0, "3D", 90.0), // another program
            i(12, 0, "3D", f64::NAN),
        ];
        let (each, all) = gpu_use(&items, &[10, 11, 12]);
        assert_eq!(
            each[&10],
            GpuUse {
                percent: 42.5,
                engine: "3D".into()
            }
        );
        assert_eq!(
            each[&11],
            GpuUse {
                percent: 20.0,
                engine: "3D".into()
            }
        );
        assert!(!each.contains_key(&99) && !each.contains_key(&12));
        assert_eq!(
            all,
            Some(GpuUse {
                percent: 62.5,
                engine: "3D".into()
            })
        );
        let (none, total) = gpu_use(&items, &[5]);
        assert!(none.is_empty() && total.is_none());
        let (_, capped) = gpu_use(&[i(1, 0, "3D", 80.0), i(2, 0, "3D", 70.0)], &[1, 2]);
        assert_eq!(capped.unwrap().percent, 100.0);
    }

    #[test]
    fn gpu_memory_adds_up_a_process_over_its_adapters() {
        let items = [
            ("pid_10_luid_0x0_0x1_phys_0".to_string(), 100.0),
            ("pid_10_luid_0x0_0x2_phys_0".to_string(), 50.0),
            ("pid_11_luid_0x0_0x1_phys_0".to_string(), 7.0),
            ("pid_99_luid_0x0_0x1_phys_0".to_string(), 1e9),
        ];
        let got = gpu_memory(&items, &[10, 11]);
        assert_eq!(got.len(), 2);
        assert_eq!(got[&10], 150.0);
        assert_eq!(got[&11], 7.0);
    }

    #[test]
    fn processes_are_named_by_what_they_do() {
        let view = "msedgewebview2.exe";
        assert_eq!(
            process_kind("empire-at-war-browser-edition.exe", "", true),
            "app"
        );
        assert_eq!(
            process_kind(
                view,
                r#""C:\x\msedgewebview2.exe" --embedded-browser-webview=1 --webview-exe-name=app.exe"#,
                false
            ),
            "browser"
        );
        assert_eq!(
            process_kind(
                view,
                r#""C:\x\msedgewebview2.exe" --type=gpu-process --gpu-preferences=AAAA"#,
                false
            ),
            "gpu"
        );
        assert_eq!(
            process_kind(view, "x --type=renderer --lang=en", false),
            "renderer"
        );
        assert_eq!(
            process_kind(
                view,
                "x --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en",
                false
            ),
            "utility (network)"
        );
        assert_eq!(
            process_kind(
                view,
                "x --type=utility --utility-sub-type=audio.mojom.AudioService",
                false
            ),
            "utility (audio)"
        );
        assert_eq!(process_kind(view, "x --type=utility", false), "utility");
        assert_eq!(
            process_kind(view, "x --type=crashpad-handler --database=y", false),
            "crash handler"
        );
        assert_eq!(process_kind("Helper.EXE", "", false), "helper");
    }

    /// Not every machine has a GPU or the counters (they came with Windows 10 1709): run by hand with
    /// `cargo test gpu_counters -- --ignored --nocapture` to see what this one gives.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn gpu_counters_answer() {
        let (engines, busiest, with_memory, dedicated) =
            win::gpu_everywhere(Duration::from_millis(500)).expect("the GPU counters open");
        println!(
            "{engines} engine instances, busiest {busiest:?}, {with_memory} processes hold {dedicated} bytes of dedicated GPU memory"
        );
        assert!(engines > 0, "GPU Engine instances");
        assert!(with_memory > 0, "GPU Process Memory instances");
    }

    #[cfg(windows)]
    #[test]
    fn this_process_is_measured() {
        let first = stats();
        assert_eq!(first["supported"], true);
        let me = std::process::id();
        let row = |v: &serde_json::Value| {
            v["processes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["pid"] == me)
                .cloned()
                .expect("the asking process is listed")
        };
        let mine = row(&first);
        assert_eq!(mine["type"], "app");
        assert!(mine["workingSetBytes"].as_u64().unwrap() > 0);
        assert!(mine["privateBytes"].as_u64().unwrap() > 0);
        assert!(
            first["intervalMs"].as_u64().unwrap() >= 200,
            "the first answer measures its own interval"
        );
        assert!(mine["cpuPercent"].is_number() && mine["ioReadBytesPerSec"].is_number());
        assert_eq!(stats(), first, "asked again at once, the same answer");

        // burn CPU on one thread for a while: the next answer shows it
        let until = std::time::Instant::now() + Duration::from_millis(400);
        let mut n = 0u64;
        while std::time::Instant::now() < until {
            n = std::hint::black_box(n.wrapping_mul(31).wrapping_add(7));
        }
        let second = stats();
        let cpu = row(&second)["cpuPercent"].as_f64().unwrap();
        assert!(cpu > 0.0 && cpu <= 100.0, "cpu {cpu}");
        assert!(
            second["total"]["workingSetBytes"].as_u64().unwrap()
                >= row(&second)["workingSetBytes"].as_u64().unwrap()
        );
    }
}
