import { db } from '../gamedata.js';
export async function renderTechTree(owner, d) {
  const game = owner.game,
    player = game.galaxy.players.find(p => p.faction === game.me),
    work = [];
  d.radios(['IDC_TECH_TREE_LAND', 'IDC_TECH_TREE_SPACE'], owner.techSpace ? 'IDC_TECH_TREE_SPACE' : 'IDC_TECH_TREE_LAND', id => {
    owner.state.techSpace = owner.techSpace = id === 'IDC_TECH_TREE_SPACE';
    owner.show(2);
  });
  for (const ctl of d.def.controls) {
    const arrow = ctl.id.match(/^IDC_(D?RIGHT|RRIGHT|DOWN)_ARROW\d+$/);
    if (arrow) {
      const file = { RIGHT: 'right', DRIGHT: '2right', RRIGHT: '3right', DOWN: 'down' }[arrow[1]];
      work.push(owner.picture(d, ctl.id, 'i_tree_arrow_' + file + '.tga'));
    }
  }
  for (const type of db.types.values()) {
    if (!type.list('Affiliation').some(f => f.toUpperCase() === game.me.toUpperCase())) continue;
    const id = 'IDC_TECHTREE_' + type.name.replace(/-/g, '_'),
      ctl = d.ctl(id);
    if (!ctl) continue;
    const unlocked = player.unlockedTypes?.some(n => n.toUpperCase() === type.name.toUpperCase()),
      locked = player.lockedTypes?.some(n => n.toUpperCase() === type.name.toUpperCase());
    const disabled = player.tech < type.num('Tech_Level', 0) || locked || (type.bool('Build_Initially_Locked') && !unlocked);
    work.push(owner.picture(d, id, type.str('Icon_Name'), disabled ? [90, 90, 90] : [255, 255, 255]));
    const label = () => ctl.setAttribute('aria-label', db.t(type.str('Text_ID')) || type.name);
    label();
    d.onLanguageRefresh(label);
    ctl.dataset.type = type.name;
    ctl.setAttribute('role', 'button');
    ctl.tabIndex = 0;
    ctl.onmouseenter = () => owner.showType(type);
    ctl.onclick = () => owner.showType(type);
    ctl.onfocus = () => owner.showType(type);
    ctl.onkeydown = e => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        owner.showType(type);
      }
    };
  }
  await Promise.all(work);
}
