'use strict';

// Curated knowledge for games whose folder names or executables are too cryptic to
// look up reliably, plus original box requirements and DOSBox tuning that the
// era-based defaults in dosboxConfig.js would get wrong.
//
// match.folders: lower-case folder names that identify the game.
// match.files:   lower-case file names that must all exist in the folder.
// era:           baseline profile (see ERA_PROFILES in dosboxConfig.js).
// tune:          per-game overrides on top of the era profile.

const { MORE_GAMES } = require('./moreGames');

const KNOWN_GAMES = [
  {
    key: 'aitd3', title: 'Alone in the Dark 3', wiki: 'Alone in the Dark 3', year: 1994,
    match: { folders: ['alone'], files: ['aitd3.exe'] }, exe: 'AITD3.EXE', era: '486',
    tune: { cycles: 25000, cyclesProtected: 50000 },
    reqs: { cpu: '386DX/33 (486 recommended)', ram: '4 MB', video: 'VGA', sound: 'Sound Blaster, AdLib, Roland', storage: '20 MB' },
  },
  {
    key: 'altered-beast', title: 'Altered Beast', wiki: 'Altered Beast', year: 1989,
    match: { folders: ['altered'], files: ['beasty.exe'] }, exe: 'BEASTY.EXE', era: 'at286',
    tune: { mouse: 'onclick' },
    reqs: { cpu: '8088 / 286', ram: '512 KB', video: 'CGA, EGA', sound: 'PC Speaker', storage: '1 MB' },
  },
  {
    key: 'battle-chess-4000', title: 'Battle Chess 4000', wiki: 'Battle Chess 4000', year: 1992,
    match: { folders: ['batchess'], files: ['bc4000.exe'] }, exe: 'BC4000.BAT', era: '386',
    tune: { cycles: 8000, mouse: 'seamless' },
    reqs: { cpu: '386SX/16', ram: '2 MB', video: 'VGA', sound: 'Sound Blaster, AdLib, Roland', storage: '10 MB' },
  },
  {
    key: 'blood', title: 'Blood', wiki: 'Blood (video game)', year: 1997,
    match: { folders: ['blood'], files: [] }, era: 'pentium',
    tune: { memsize: 48 },
    reqs: { cpu: 'Pentium 90', ram: '8 MB (16 MB recommended)', video: 'VGA / SVGA (VESA)', sound: 'Sound Blaster, GUS, General MIDI', storage: '50 MB + CD-ROM' },
  },
  {
    key: 'caesar2', title: 'Caesar II', wiki: 'Caesar II', year: 1995,
    match: { folders: ['caesar2'], files: [] }, era: '486',
    tune: { cycles: 15000, cyclesProtected: 50000, mouse: 'seamless' },
    reqs: { cpu: '486DX/33', ram: '8 MB', video: 'SVGA (VESA)', sound: 'Sound Blaster', storage: '30 MB + CD-ROM' },
  },
  {
    key: 'colonels-bequest', title: "The Colonel's Bequest", wiki: "The Colonel's Bequest", year: 1989,
    match: { folders: ['cb', 'colonel'], files: [] }, exe: 'SIERRA.COM', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '8088 (286 recommended)', ram: '512 KB', video: 'EGA, VGA (16-color)', sound: 'AdLib, Roland MT-32', storage: '5 MB' },
  },
  {
    key: 'civilization', title: "Sid Meier's Civilization", wiki: 'Civilization (video game)', year: 1991,
    match: { folders: ['civilization', 'civ'], files: [] }, era: '386',
    tune: { cycles: 12000, mouse: 'seamless' },
    reqs: { cpu: '286 (386 recommended)', ram: '640 KB', video: 'EGA, VGA', sound: 'AdLib, Sound Blaster, Roland', storage: '3 MB' },
  },
  {
    key: 'red-alert', title: 'Command & Conquer: Red Alert', wiki: 'Command & Conquer: Red Alert', year: 1996,
    match: { folders: ['cnc red alert', 'redalert'], files: [] }, era: 'pentium',
    tune: { memsize: 32, mouse: 'seamless' },
    reqs: { cpu: '486DX2/66 (Pentium recommended)', ram: '8 MB (16 MB recommended)', video: 'SVGA (VESA)', sound: 'Sound Blaster, GUS', storage: '40 MB + 2x CD-ROM' },
  },
  {
    key: 'conquests-of-camelot', title: 'Conquests of Camelot: The Search for the Grail', wiki: 'Conquests of Camelot: The Search for the Grail', year: 1990,
    match: { folders: ['coc'], files: [] }, exe: 'SIERRA.COM', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '8088 (286 recommended)', ram: '512 KB', video: 'EGA, VGA (16-color)', sound: 'AdLib, Roland MT-32', storage: '5 MB' },
  },
  {
    key: 'dragons-lair-3', title: "Dragon's Lair III: The Curse of Mordread", wiki: "Dragon's Lair III: The Curse of Mordread", year: 1993,
    match: { folders: ['dl3'], files: ['dl3.exe'] }, exe: 'DL3.EXE', era: '386',
    tune: { cycles: 12000 },
    reqs: { cpu: '386SX/16', ram: '640 KB', video: 'VGA', sound: 'Sound Blaster', storage: '20 MB' },
  },
  {
    key: 'dark-sun', title: 'Dark Sun: Shattered Lands', wiki: 'Dark Sun: Shattered Lands', year: 1993,
    match: { folders: ['dark sun shattered lands', 'darksun'], files: [] }, era: '486',
    tune: { cycles: 25000, cyclesProtected: 50000, mouse: 'seamless' },
    reqs: { cpu: '386/25 (486 recommended)', ram: '4 MB', video: 'VGA', sound: 'Sound Blaster, AdLib, Roland, GUS', storage: '20 MB' },
  },
  {
    key: 'day-of-the-tentacle', title: 'Day of the Tentacle', wiki: 'Day of the Tentacle', year: 1993,
    match: { folders: ['daytentacle', 'dott'], files: [] },
    reqs: { cpu: '386/25 (486 recommended)', ram: '4 MB', video: 'VGA', sound: 'Sound Blaster, General MIDI, Roland', storage: '7 MB (floppy) / CD-ROM' },
  },
  {
    key: 'doom', title: 'Doom', wiki: 'Doom (1993 video game)', year: 1993,
    match: { folders: ['doom'], files: ['doom.exe'] }, exe: 'DOOM.EXE', era: '486',
    tune: { cycles: 25000, cyclesProtected: 50000 },
    reqs: { cpu: '386DX/33 (486DX/33 recommended)', ram: '4 MB', video: 'VGA', sound: 'Sound Blaster, GUS, General MIDI', storage: '12 MB' },
  },
  {
    key: 'duke3d', title: 'Duke Nukem 3D', wiki: 'Duke Nukem 3D', year: 1996,
    match: { folders: ['dukenukem3d', 'duke3d'], files: [] }, era: 'pentium',
    tune: { memsize: 32 },
    reqs: { cpu: '486DX2/66 (Pentium recommended)', ram: '8 MB (16 MB recommended)', video: 'VGA / SVGA (VESA)', sound: 'Sound Blaster, GUS, General MIDI', storage: '30 MB + CD-ROM' },
  },
  {
    key: 'eob1', title: 'Eye of the Beholder', wiki: 'Eye of the Beholder (video game)', year: 1991,
    match: { folders: ['eob'], files: ['eob.exe'] }, exe: 'START.EXE', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '286/10', ram: '640 KB', video: 'EGA, VGA', sound: 'AdLib, Sound Blaster', storage: '4 MB' },
  },
  {
    key: 'gauntlet2', title: 'Gauntlet II', wiki: 'Gauntlet II', year: 1990,
    match: { folders: ['gaunt'], files: ['gauntlet.exe'] }, exe: 'GAUNTLET.EXE', era: 'at286',
    tune: { cycles: 3000 },
    reqs: { cpu: '8088 / 286', ram: '512 KB', video: 'CGA, EGA, Tandy', sound: 'PC Speaker, Tandy', storage: '1 MB' },
  },
  {
    key: 'space-hulk', title: 'Space Hulk', wiki: 'Space Hulk (1993 video game)', year: 1993,
    match: { folders: ['hulk'], files: ['hulk.exe'] }, exe: 'HULK.EXE', era: '486',
    tune: { cycles: 20000, cyclesProtected: 40000 },
    reqs: { cpu: '386SX/25 (486 recommended)', ram: '2 MB', video: 'VGA', sound: 'Sound Blaster, AdLib, Roland', storage: '15 MB' },
  },
  {
    key: 'indy-atlantis', title: 'Indiana Jones and the Fate of Atlantis', wiki: 'Indiana Jones and the Fate of Atlantis', year: 1992,
    match: { folders: ['indianajonesantlantis', 'atlantis'], files: [] },
    reqs: { cpu: '286/12 (386 recommended)', ram: '640 KB', video: 'VGA', sound: 'Sound Blaster, AdLib, Roland', storage: '11 MB (floppy) / CD-ROM' },
  },
  {
    key: 'kq3', title: "King's Quest III: To Heir Is Human", wiki: "King's Quest III: To Heir Is Human", year: 1986,
    match: { folders: ['kq3'], files: ['king.com'] }, exe: 'KQ3.BAT', era: 'xt',
    tune: { cycles: 1000 },
    reqs: { cpu: '8088 / 8086', ram: '256 KB', video: 'CGA, EGA, Tandy, PCjr', sound: 'PC Speaker, Tandy 3-voice', storage: '1 MB' },
  },
  {
    key: 'kq4', title: "King's Quest IV: The Perils of Rosella", wiki: "King's Quest IV: The Perils of Rosella", year: 1988,
    match: { folders: ['kq4'], files: [] }, exe: 'SIERRA.COM', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '8088 (286 recommended)', ram: '512 KB', video: 'EGA, VGA (16-color)', sound: 'AdLib, Roland MT-32', storage: '5 MB' },
  },
  {
    key: 'lemmings', title: 'Lemmings', wiki: 'Lemmings (video game)', year: 1991,
    match: { folders: ['lemmings'], files: ['vgalemmi.exe'] }, exe: 'LEMMINGS.BAT', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '286', ram: '640 KB', video: 'CGA, EGA, Tandy, VGA', sound: 'AdLib, Sound Blaster', storage: '2 MB' },
  },
  {
    key: 'loom', title: 'Loom', wiki: 'Loom (video game)', year: 1990,
    match: { folders: ['loom'], files: [] },
    reqs: { cpu: '286 (386 for CD version)', ram: '640 KB', video: 'EGA, VGA (CD: 256-color)', sound: 'AdLib, Sound Blaster, Roland, CD audio', storage: '5 MB / CD-ROM' },
  },
  {
    key: 'megaman-x', title: 'Mega Man X', wiki: 'Mega Man X (video game)', year: 1995,
    match: { folders: ['mmx'], files: ['mmxrun.exe'] }, exe: 'MMX.BAT', era: '486',
    tune: { cycles: 25000, cyclesProtected: 50000 },
    reqs: { cpu: '486DX/33', ram: '4 MB', video: 'VGA', sound: 'Sound Blaster, General MIDI', storage: '10 MB' },
  },
  {
    key: 'moo2', title: 'Master of Orion II: Battle at Antares', wiki: 'Master of Orion II: Battle at Antares', year: 1996,
    match: { folders: ['moo2'], files: ['orion2.exe'] }, exe: 'ORION2.EXE', era: 'pentium',
    tune: { cyclesProtected: 100000, memsize: 32, mouse: 'seamless' },
    reqs: { cpu: '486DX2/66 (Pentium recommended)', ram: '8 MB', video: 'SVGA (VESA)', sound: 'Sound Blaster, General MIDI', storage: '30 MB + 2x CD-ROM' },
  },
  {
    key: 'master-of-magic', title: 'Master of Magic', wiki: 'Master of Magic', year: 1994,
    match: { folders: ['mom'], files: ['magic.exe'] }, exe: 'MAGIC.EXE', era: '486',
    tune: { cycles: 25000, mouse: 'seamless' },
    reqs: { cpu: '386/25', ram: '4 MB (EMS)', video: 'VGA', sound: 'Sound Blaster, AdLib, Roland, General MIDI', storage: '15 MB' },
  },
  {
    key: 'mechwarrior', title: 'MechWarrior', wiki: 'MechWarrior (1989 video game)', year: 1989,
    match: { folders: ['mw'], files: ['mw_main.exe'] }, exe: 'MW.EXE', era: 'at286',
    tune: { cycles: 1500 },
    reqs: { cpu: '8088 (286 recommended)', ram: '512 KB', video: 'CGA, EGA, Tandy', sound: 'PC Speaker, Tandy', storage: '1 MB' },
  },
  {
    key: 'oregon-trail', title: 'The Oregon Trail Deluxe', wiki: 'The Oregon Trail (1985 video game)', year: 1992,
    match: { folders: ['ot'], files: ['oregon.exe'] }, exe: 'OREGON.EXE', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '286', ram: '640 KB', video: 'EGA, VGA', sound: 'PC Speaker, Sound Blaster', storage: '3 MB' },
  },
  {
    // Folder match only: scidhuv.exe is the generic SCI interpreter shared by many Sierra games.
    key: 'qfg1-vga', title: 'Quest for Glory: So You Want to Be a Hero', wiki: 'Quest for Glory: So You Want to Be a Hero', year: 1992,
    match: { folders: ['q4g', 'qfg1'], files: [] }, era: '386',
    tune: { cycles: 8000, mouse: 'seamless' },
    reqs: { cpu: '286/12 (386 recommended)', ram: '640 KB', video: 'VGA (256-color)', sound: 'Sound Blaster, AdLib, Roland, General MIDI', storage: '7 MB' },
  },
  {
    key: 'simcity', title: 'SimCity', wiki: 'SimCity (1989 video game)', year: 1989,
    match: { folders: ['sim', 'simcity'], files: ['simcity.exe'] }, exe: 'SIMCITY.EXE', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '8088 (286 recommended)', ram: '512 KB', video: 'CGA, EGA, Hercules, Tandy', sound: 'PC Speaker', storage: '1 MB' },
  },
  {
    key: 'sq3', title: 'Space Quest III: The Pirates of Pestulon', wiki: 'Space Quest III', year: 1989,
    match: { folders: ['sq3'], files: [] }, exe: 'SIERRA.COM', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '8088 (286 recommended)', ram: '512 KB', video: 'EGA, VGA (16-color)', sound: 'AdLib, Roland MT-32', storage: '5 MB' },
  },
  {
    key: 'tie-fighter', title: 'Star Wars: TIE Fighter', wiki: 'Star Wars: TIE Fighter', year: 1994,
    match: { folders: ['tie'], files: ['tie.exe'] }, exe: 'TIE.EXE', era: '486',
    tune: { cycles: 25000, cyclesProtected: 50000 },
    reqs: { cpu: '386/33 (486/33 recommended)', ram: '4 MB', video: 'VGA', sound: 'Sound Blaster, GUS, Roland, General MIDI', storage: '13 MB' },
  },
  {
    key: 'warcraft2', title: 'Warcraft II: Tides of Darkness', wiki: 'Warcraft II: Tides of Darkness', year: 1995,
    match: { folders: ['warc2', 'war2'], files: ['war2.exe'] }, exe: 'WAR2CD.BAT', era: 'pentium',
    tune: { cyclesProtected: 60000, memsize: 32, mouse: 'seamless' },
    reqs: { cpu: '486/33', ram: '8 MB', video: 'SVGA (VESA)', sound: 'Sound Blaster, GUS, General MIDI', storage: '25 MB + 2x CD-ROM' },
  },
  {
    key: 'wing-commander-2', title: 'Wing Commander II: Vengeance of the Kilrathi', wiki: 'Wing Commander II: Vengeance of the Kilrathi', year: 1991,
    match: { folders: ['wc2'], files: ['wc2.exe'] }, exe: 'WC2.EXE', era: '386',
    // WC2 is famously speed-sensitive; a 386DX-40 is the sweet spot.
    tune: { cycles: 8000 },
    reqs: { cpu: '386/25 (386/33 recommended)', ram: '640 KB + 1 MB EMS', video: 'VGA', sound: 'AdLib, Sound Blaster, Roland', storage: '10 MB' },
  },
  {
    key: 'wolf3d', title: 'Wolfenstein 3D', wiki: 'Wolfenstein 3D', year: 1992,
    match: { folders: ['wolf3d'], files: ['wolf3d.exe'] }, exe: 'WOLF3D.EXE', era: '386',
    tune: { cycles: 12000 },
    reqs: { cpu: '286 (386 recommended)', ram: '640 KB', video: 'VGA', sound: 'AdLib, Sound Blaster', storage: '3 MB' },
  },
  {
    key: 'carmen-world', title: 'Where in the World Is Carmen Sandiego? Deluxe', wiki: 'Where in the World Is Carmen Sandiego? (1985 video game)', year: 1990,
    match: { folders: ['wwics'], files: ['carmen.exe'] }, exe: 'CARMEN.EXE', era: 'at286',
    tune: { cycles: 3000, mouse: 'seamless' },
    reqs: { cpu: '286', ram: '640 KB', video: 'EGA, VGA', sound: 'PC Speaker, Sound Blaster', storage: '3 MB' },
  },
  ...MORE_GAMES,
];

function fileSetHas(files, needed) {
  return needed.every((f) => files.has(f));
}

/**
 * Find the curated entry for a folder. Folder-name match wins; otherwise an entry whose
 * required files are all present (and non-empty) matches.
 * @param {string} folderName
 * @param {Set<string>} lowerFiles lower-cased file names in the folder
 */
function matchKnownGame(folderName, lowerFiles) {
  const name = folderName.toLowerCase();
  const byFolder = KNOWN_GAMES.find((g) => g.match.folders.includes(name));
  if (byFolder) return byFolder;
  return KNOWN_GAMES.find((g) => g.match.files.length > 0 && fileSetHas(lowerFiles, g.match.files)) || null;
}

module.exports = { KNOWN_GAMES, matchKnownGame };
