// Discord's rich presence talks to the desktop Discord client, which Android and iOS do not
// have: the status is accepted and dropped.
#[derive(Clone, PartialEq, Default)]
pub struct Status {
    pub details: String,
    pub state: String,
    pub large_text: String,
    pub start: i64,
}

pub fn set(_status: Option<Status>) {}
