use discord_rich_presence::activity::{Activity, Assets, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::Duration;

const APP_ID: &str = "1573409525950713906";
const REFRESH: Duration = Duration::from_secs(15);

#[derive(Clone, PartialEq, Default)]
pub struct Status {
    pub details: String,
    pub state: String,
    pub large_text: String,
    pub start: i64,
}

static TX: OnceLock<Sender<Option<Status>>> = OnceLock::new();

pub fn set(status: Option<Status>) {
    let _ = TX.get_or_init(spawn).send(status);
}

fn text(s: &str) -> Option<String> {
    let s: String = s.trim().chars().take(120).collect();
    (s.chars().count() >= 2).then_some(s)
}

fn activity(s: &Status) -> Activity<'_> {
    let mut assets = Assets::new().large_image("logo");
    if let Some(t) = text(&s.large_text) {
        assets = assets.large_text(t);
    }
    let mut a = Activity::new().assets(assets);
    if let Some(t) = text(&s.details) {
        a = a.details(t);
    }
    if let Some(t) = text(&s.state) {
        a = a.state(t);
    }
    if s.start > 0 {
        a = a.timestamps(Timestamps::new().start(s.start));
    }
    a
}

fn spawn() -> Sender<Option<Status>> {
    let (tx, rx) = channel::<Option<Status>>();
    std::thread::spawn(move || {
        let mut want: Option<Status> = None;
        let mut client: Option<DiscordIpcClient> = None;
        loop {
            match rx.recv_timeout(REFRESH) {
                Ok(mut s) => {
                    while let Ok(next) = rx.try_recv() {
                        s = next;
                    }
                    if s == want && client.is_some() {
                        continue;
                    }
                    want = s;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let Some(s) = want.as_ref() else {
                if let Some(mut c) = client.take() {
                    let _ = c.clear_activity();
                    let _ = c.close();
                }
                continue;
            };
            if client.is_none() {
                let mut c = DiscordIpcClient::new(APP_ID);
                if c.connect().is_err() {
                    continue;
                }
                client = Some(c);
            }
            if let Some(c) = client.as_mut() {
                if c.set_activity(activity(s)).is_err() {
                    let _ = c.close();
                    client = None;
                }
            }
        }
    });
    tx
}
