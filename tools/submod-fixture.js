export const stacks = [
  [[], 'base', 'base', null],
  [['Parent'], 'parent', 'parent', 'inherited'],
  [['Parent', 'Patch'], 'patch', null, 'inherited'],
  [['Patch', 'Parent'], 'parent', 'parent', 'inherited']
];

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
