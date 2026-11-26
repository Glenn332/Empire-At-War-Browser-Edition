// Width in pixels of the bar floating over a space unit. `radius` is the hull's
// on-screen radius; `icon` is the bar width under a unit icon (0 when none is drawn).
// Squadrons keep the icon-wide bar, ships with an icon never get a bar narrower than it.
// The original game picks one of three bar textures by GUI_Bracket_Size (34, 68 and
// 102 pixels wide) and grows it as the camera closes in; here the hull's own on-screen
// size stands in for both, so one rule covers hero ships and plain ones alike.
export function spaceBarWidth(radius, icon = 0, squad = false) {
  if (icon && squad) return icon;
  return Math.max(icon, 26, Math.min(120, radius * 1.5));
}

// Land units: GUI_Bracket_Size 2 marks the largest walkers and platforms.
export function landBarWidth(u) {
  if (u.structure || u.type?.num('GUI_Bracket_Size', 0) >= 2) return 70;
  return u.maxHealth > 150 ? 44 : 22;
}
