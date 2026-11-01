'use strict';

// Builds a DOSBox Staging (0.82+) config for one game.
// Era: user override, else the curated entry, else derived from the game's release year.
// A game with none of those has no profile: its release year is required.
// Settings: era profile < bundle hints < curated tune < user overrides.

// Cycle values follow the DOSBox Staging reference table (386DX-33 = 6000, 486DX/2-66 = 25000,
// Pentium 90 = 50000). Real-mode cycles stay fixed so speed-sensitive games keep their timing.
const ERA_PROFILES = {
  xt: { label: '8088 / XT (1981–87)', cycles: 1000, cyclesProtected: 'auto', memsize: 4, core: 'normal', mouse: 'onclick' },
  at286: { label: '286 AT (1987–90)', cycles: 3000, cyclesProtected: 'auto', memsize: 4, core: 'normal', mouse: 'onclick' },
  '386': { label: '386 (1990–93)', cycles: 8000, cyclesProtected: 12000, memsize: 8, core: 'auto', mouse: 'onclick' },
  '486': { label: '486 (1993–95)', cycles: 25000, cyclesProtected: 50000, memsize: 16, core: 'auto', mouse: 'onclick' },
  pentium: { label: 'Pentium (1995+)', cycles: 25000, cyclesProtected: 'max', memsize: 32, core: 'dynamic', mouse: 'onclick' },
};

// Settings that describe the emulated CPU/RAM. They follow the era, so picking a different era
// replaces them instead of being masked by the curated tune.
const SPEED_KEYS = ['cycles', 'cyclesProtected', 'memsize', 'core'];

/**
 * Era for a release year. A DOS extender means the game needs at least a 486-class speed.
 * @returns era key, or null without a year
 */
function guessEra({ year, extended }) {
  if (!Number.isFinite(year)) return null;
  if (year >= 1995) return 'pentium';
  if (year >= 1993) return '486';
  if (year >= 1990) return extended ? '486' : '386';
  if (year >= 1987) return 'at286';
  return 'xt';
}

/** Read the few settings worth keeping from a pre-made bundle config (e.g. tuned cycles). */
function parseBundleHints(confText) {
  const hints = {};
  const lines = confText.replace(/\r/g, '').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*(cycles|cpu_cycles|memsize)\s*=\s*(\S+)/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].toLowerCase();
    if (key === 'memsize' && /^\d+$/.test(val)) hints.memsize = Number(val);
    // "cycles=fixed 15000" or "cycles=15000"; "auto"/"max" carry no tuning information.
    const num = val === 'fixed' ? Number((line.match(/fixed\s+(\d+)/i) || [])[1]) : Number(val);
    if ((key === 'cycles' || key === 'cpu_cycles') && Number.isFinite(num) && num > 0) hints.cycles = num;
  }
  return hints;
}

function withoutSpeed(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !SPEED_KEYS.includes(k)));
}

/** The era the game should get before any user override, or null without a release year. */
function recommendedEra(game) {
  const known = game.known || {};
  if (known.era) return known.era;
  return guessEra({ year: Number(game.releaseYear), extended: Boolean(game.hasExtender) });
}

/**
 * Resolve the effective profile for a game.
 * @param {object} game  library game record with .known and .releaseYear
 * @param {object} settings global settings
 * @returns profile, or null when the game has no era and no release year
 */
function resolveProfile(game, settings) {
  const known = game.known || {};
  const recommended = recommendedEra(game);
  const chosenEra = game.overrides && game.overrides.era;
  const era = chosenEra || recommended;
  if (!ERA_PROFILES[era]) return null;
  // A user-picked era means "emulate that machine": its speed wins over curated speed values.
  const eraChanged = Boolean(chosenEra) && chosenEra !== recommended;
  const base = ERA_PROFILES[era];
  const profile = {
    era,
    eraLabel: base.label,
    cycles: base.cycles,
    cyclesProtected: base.cyclesProtected,
    memsize: base.memsize,
    core: base.core,
    mouse: base.mouse,
    machine: 'svga_s3',
    shader: settings.shader || 'crt-auto',
    fullscreen: settings.fullscreen !== false,
    integerScaling: settings.integerScaling || 'auto',
    aspect: 'auto',
    sbtype: 'sb16',
    gus: false,
    midi: settings.midiPreference || 'auto',
    reverb: settings.reverb || 'small',
    chorus: settings.chorus || 'light',
    crossfeed: settings.crossfeed || 'off',
  };
  // Bundle hints were hand-tuned by whoever packaged the game; trust them over era values,
  // but not over curated entries.
  if (!game.knownKey && game.bundleHints) Object.assign(profile, eraChanged ? withoutSpeed(game.bundleHints) : game.bundleHints);
  if (known.tune) Object.assign(profile, eraChanged ? withoutSpeed(known.tune) : known.tune);
  if (game.overrides) {
    for (const [k, v] of Object.entries(game.overrides)) {
      if (v !== undefined && v !== null && v !== '' && k !== 'era') profile[k] = v;
    }
  }
  return profile;
}

/** Pick the MIDI device for the host. MT-32 only for games built for it, when ROMs exist. */
function resolveMidi(profile, env) {
  const pref = profile.midi;
  if (pref === 'mt32' && env.mt32RomDir) return { device: 'mt32', romdir: env.mt32RomDir };
  if (pref === 'none') return { device: 'none' };
  if (env.soundfont) return { device: 'fluidsynth', soundfont: env.soundfont };
  if (env.platform === 'darwin') return { device: 'coreaudio' };
  return { device: 'auto' };
}

function quote(p) {
  return `"${p}"`;
}

/**
 * Build the [autoexec] lines that mount and start the game.
 * launch.mounts: [{ drive, path, kind: 'dir'|'cdrom'|'image' }], launch.commands: [string]
 */
function buildAutoexec(launch) {
  const out = ['@echo off'];
  for (const m of launch.mounts) {
    if (m.kind === 'image') out.push(`imgmount ${m.drive} ${quote(m.path)} -t iso`);
    else if (m.kind === 'cdrom') out.push(`mount ${m.drive} ${quote(m.path)} -t cdrom`);
    else out.push(`mount ${m.drive} ${quote(m.path)}`);
  }
  out.push(...launch.commands);
  // Close DOSBox when the game exits so the launcher can record play time.
  if (!launch.commands.some((c) => /^exit\b/i.test(c.trim()))) out.push('exit');
  return out;
}

/**
 * Generate the full .conf text.
 * @param {object} game     library record with .launch.dos
 * @param {object} settings global settings
 * @param {object} env      { platform, soundfont, mt32RomDir, captureDir }
 */
function generateDosboxConfig(game, settings, env) {
  const p = resolveProfile(game, settings);
  if (!p) throw new Error(`${game.title}: release year required. Set it in Edit info.`);
  const midi = resolveMidi(p, env);
  const lines = [];
  const section = (name, entries) => {
    lines.push(`[${name}]`);
    for (const [k, v] of entries) if (v !== undefined && v !== null) lines.push(`${k} = ${v}`);
    lines.push('');
  };

  lines.push(`# Generated by RetroShelf for "${game.title}"`);
  lines.push(`# Profile: ${p.eraLabel}${game.overrides && Object.keys(game.overrides).length ? ' (with your overrides)' : ''}`);
  lines.push('');

  section('sdl', [
    ['fullscreen', p.fullscreen],
    ['output', 'opengl'],
    ['vsync', 'auto'],
  ]);
  section('dosbox', [
    ['machine', p.machine],
    ['memsize', p.memsize],
  ]);
  section('render', [
    ['glshader', p.shader],
    ['aspect', p.aspect],
    ['integer_scaling', p.integerScaling],
    ['viewport', 'fit'],
  ]);
  section('cpu', [
    ['core', p.core],
    ['cputype', 'auto'],
    ['cpu_cycles', p.cycles],
    ['cpu_cycles_protected', p.cyclesProtected],
  ]);
  if (env.captureDir) section('capture', [['capture_dir', env.captureDir]]);
  section('mouse', [['mouse_capture', p.mouse]]);
  section('mixer', [
    ['reverb', p.reverb],
    ['chorus', p.chorus],
    ['crossfeed', p.crossfeed],
  ]);
  section('midi', [['mididevice', midi.device], ['mpu401', 'intelligent']]);
  if (midi.soundfont) section('fluidsynth', [['soundfont', midi.soundfont]]);
  if (midi.romdir) section('mt32', [['romdir', midi.romdir], ['model', 'auto']]);
  section('sblaster', [
    ['sbtype', p.sbtype],
    ['sbbase', 220],
    ['irq', 7],
    ['dma', 1],
    ['hdma', 5],
    ['oplmode', 'auto'],
  ]);
  section('gus', [['gus', p.gus]]);
  section('dos', [
    ['xms', true],
    ['ems', true],
    ['umb', true],
  ]);

  lines.push('[autoexec]');
  lines.push(...buildAutoexec(game.launch.dos));
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  ERA_PROFILES,
  guessEra,
  parseBundleHints,
  resolveProfile,
  resolveMidi,
  buildAutoexec,
  generateDosboxConfig,
};
