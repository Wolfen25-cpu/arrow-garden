// Progress and settings in localStorage. Every access is guarded: storage can be
// missing or blocked (private mode, cleared site data) and the game must still run.

const KEY = 'arrowGarden.v1';

export const DEFAULTS = {
  level: 1,
  maxLevel: 1,
  muted: false,
  vibration: true,
  showMoves: true,
  theme: 'auto', // 'auto' | 'light' | 'dark'
  progressAt: 0, // timestamps used to merge with cloud saves
  settingsAt: 0,
  account: false, // signed in last time: reconnect to the cloud on startup
  tutorialDone: false,
  lang: 'es', // device-only, not synced (cloud documents would need a rules change)
};

const THEMES = ['auto', 'light', 'dark'];
const LANGS = ['es', 'en'];

// Accepts anything (stored JSON, cloud data) and returns a well-formed state.
export function sanitize(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const int = (v, fallback) => (Number.isInteger(v) && v >= 1 && v <= 999 ? v : fallback);
  const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  const time = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const maxLevel = int(data.maxLevel, DEFAULTS.maxLevel);
  return {
    level: Math.min(int(data.level, DEFAULTS.level), maxLevel),
    maxLevel,
    muted: bool(data.muted, DEFAULTS.muted),
    vibration: bool(data.vibration, DEFAULTS.vibration),
    showMoves: bool(data.showMoves, DEFAULTS.showMoves),
    theme: THEMES.includes(data.theme) ? data.theme : DEFAULTS.theme,
    progressAt: time(data.progressAt),
    settingsAt: time(data.settingsAt),
    account: bool(data.account, DEFAULTS.account),
    tutorialDone: bool(data.tutorialDone, DEFAULTS.tutorialDone),
    lang: LANGS.includes(data.lang) ? data.lang : DEFAULTS.lang,
  };
}

// Combines this device's state with the cloud copy: the furthest progress is
// never lost, and for everything else the most recent change wins.
export function mergeProgress(local, remoteRaw) {
  if (!remoteRaw) return local;
  const remote = sanitize(remoteRaw);
  const merged = { ...local };
  merged.maxLevel = Math.max(local.maxLevel, remote.maxLevel);
  if (remote.progressAt > local.progressAt) {
    merged.level = remote.level;
    merged.progressAt = remote.progressAt;
  }
  merged.level = Math.min(merged.level, merged.maxLevel);
  if (remote.settingsAt > local.settingsAt) {
    for (const key of ['muted', 'vibration', 'showMoves', 'theme', 'settingsAt']) merged[key] = remote[key];
  }
  return merged;
}

export function loadState() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitize(state)));
  } catch {
    // Storage unavailable: progress lasts for this session only.
  }
}
