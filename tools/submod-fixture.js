export const stacks = [
  { mods: [], reads: { Winner: 'base', Mask: 'base', ParentOnly: null } },
  { mods: ['Parent'], reads: { Winner: 'parent', Mask: 'parent', ParentOnly: 'inherited' } },
  { mods: ['Parent', 'Patch'], reads: { Winner: 'patch', Mask: null, ParentOnly: 'inherited' } },
  { mods: ['Patch', 'Parent'], reads: { Winner: 'parent', Mask: 'parent', ParentOnly: 'inherited' } }
];

export function* stackReads(row, edition) {
  for (const [name, expected] of Object.entries({ ...row.reads, Edition: edition })) {
    yield [`data/probe/${name}.txt`, expected];
    yield [`DATA\\PROBE\\${name.toUpperCase()}.TXT`, expected];
  }
}

export function fixtureFiles() {
  const png = encoded => Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  return [
    ['game/GameData/Data/megafiles.xml', '<MegaFiles/>'],
    ['game/corruption/Data/megafiles.xml', '<MegaFiles/>'],
    ['game/GameData/Data/Probe/Edition.txt', 'eaw'],
    ['game/corruption/Data/Probe/Edition.txt', 'foc'],
    ['game/GameData/Data/Probe/Winner.txt', 'base'],
    ['game/GameData/Data/Probe/Mask.txt', 'base'],
    ['Parent/Data/Probe/Winner.txt', 'parent'],
    ['Parent/Data/Probe/Mask.txt', 'parent'],
    ['Parent/Data/Probe/ParentOnly.txt', 'inherited'],
    ['Patch/data/probe/WINNER.TXT', 'patch'],
    ['Patch/data/probe/MASK.TXT', ''],
    [
      'game/GameData/Data/Art/Textures/probe.png',
      png('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQi9oCAAHGAS12wgv0AAAAAElFTkSuQmCC')
    ],
    [
      'Patch/data/Art/Textures/CommandBar/Empire/probe.png',
      png('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4kKAAAAO0AXEq2UIxAAAAAElFTkSuQmCC')
    ]
  ];
}
