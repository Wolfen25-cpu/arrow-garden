// Entry point: wires the game model, renderer, input, audio and UI together.
// The app is in one of three modes: 'home' (start screen), 'play' or 'tutorial'.

import { Game } from './game.js';
import { generateLevel } from './generator.js';
import { LEVEL_COUNT } from './levels.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { Sound, vibrate } from './audio.js';
import { loadState, mergeProgress, saveState } from './storage.js';
import { createUI } from './ui.js';
import { TUTORIAL_DONE, TUTORIAL_LEVEL, TUTORIAL_STEPS } from './tutorial.js';
import * as cloud from './cloud.js';
import { setupAccount } from './account.js';

const canvas = document.getElementById('board');
const renderer = new Renderer(canvas);
const sound = new Sound();
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const state = loadState();
let mode = 'home';
let game = null;
let tutorialStep = 0;
let winTimer = 0;
let cloudUser = null;
let cloudStart = null;
let pushTimer = 0;

const ui = createUI({
  onPlay: play,
  onTutorial: startTutorial,
  onHome: goHome,
  onAccount: () => account.open(),
  onTutorialEnd: endTutorial,
  onPrev: () => startLevel(state.level - 1),
  onNext: () => startLevel(state.level + 1),
  onUndo: undo,
  onHint: hint,
  onRestart: restart,
  onSettingsChange: changeSettings,
  onWinNext: () => startLevel(nextLevel()),
});

const account = setupAccount({ ensureCloud });

const nextLevel = () => (state.level >= LEVEL_COUNT ? 1 : state.level + 1);

// ---------- Screens ----------

function goHome() {
  mode = 'home';
  clearTimeout(winTimer);
  ui.hideWin();
  renderer.clearHint();
  ui.showHome({ level: state.level, tutorialDone: state.tutorialDone });
}

function play() {
  sound.unlock();
  const resume = mode === 'home' && game && game.level === state.level && !game.isWon;
  mode = 'play';
  ui.setTutorial(false);
  ui.showGame();
  if (resume) {
    renderer.requestDraw();
    refresh();
  } else {
    startLevel(state.level);
  }
}

function startLevel(level) {
  mode = 'play';
  clearTimeout(winTimer);
  ui.hideWin();
  state.level = Math.min(Math.max(1, level), state.maxLevel, LEVEL_COUNT);
  game = new Game(generateLevel(state.level));
  renderer.setGame(game);
  sound.resetStreak();
  persist();
  refresh();
}

// ---------- Tutorial ----------

function startTutorial() {
  sound.unlock();
  mode = 'tutorial';
  clearTimeout(winTimer);
  tutorialStep = 0;
  ui.showGame();
  ui.setTutorial(true);
  game = new Game(TUTORIAL_LEVEL);
  renderer.setGame(game);
  sound.resetStreak();
  showTutorialStep();
}

function showTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStep];
  ui.setCoach(step.text);
  const target = game.arrows.find((a) => a.id === step.target);
  if (target) renderer.showHint(target, { persistent: true });
}

function advanceTutorial(result) {
  if (result.type !== TUTORIAL_STEPS[tutorialStep].expect) return;
  tutorialStep++;
  if (tutorialStep < TUTORIAL_STEPS.length) {
    showTutorialStep();
    return;
  }
  winTimer = setTimeout(() => {
    sound.win();
    ui.setCoach(TUTORIAL_DONE, { done: true });
  }, renderer.calm ? 150 : 700);
}

function endTutorial() {
  state.tutorialDone = true;
  persist();
  mode = 'home'; // so play() starts the real level instead of resuming the tutorial board
  play();
}

// ---------- Saving ----------

function persist() {
  saveState(state);
  schedulePush();
}

// ---------- Cloud sync (optional) ----------

function ensureCloud() {
  cloudStart ??= cloud.start(onUserChange).catch((err) => {
    cloudStart = null;
    throw err;
  });
  return cloudStart;
}

async function onUserChange(user) {
  cloudUser = user;
  account.setUser(user);
  state.account = Boolean(user);
  if (!user) {
    saveState(state);
    return;
  }
  try {
    const remote = await cloud.pull(user.uid);
    const level = state.level;
    Object.assign(state, mergeProgress(state, remote));
    applySettings();
    // Jump to the synced level only if it would not interrupt a game in progress.
    if (mode === 'play' && game.moves > 0) state.level = level;
    if (mode === 'play' && state.level !== game.level) {
      startLevel(state.level);
    } else {
      persist();
      refresh();
      if (mode === 'home') ui.showHome({ level: state.level, tutorialDone: state.tutorialDone });
    }
    await pushNow();
  } catch (err) {
    console.warn('Cloud sync failed', err);
    account.setStatus('No se pudo sincronizar ahora. Se intentará de nuevo al avanzar.', true);
  }
}

function schedulePush() {
  if (!cloudUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow().catch((err) => console.warn('Cloud save failed', err)), 1500);
}

function pushNow() {
  clearTimeout(pushTimer);
  return cloudUser ? cloud.push(cloudUser.uid, state) : Promise.resolve();
}

// ---------- Settings ----------

function changeSettings(changes) {
  Object.assign(state, changes, { settingsAt: Date.now() });
  persist();
  applySettings();
  refresh();
}

function applySettings() {
  sound.muted = state.muted;
  applyTheme();
  ui.setSettings(state);
}

function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#1d2030' : '#f4ede1';
  renderer.readTheme();
}

// ---------- Play ----------

function refresh() {
  if (mode !== 'play' || !game) return;
  ui.setLevel(state.level, Math.min(state.maxLevel, LEVEL_COUNT));
  ui.setMoves(game.moves, state.showMoves);
  ui.setUndo(game.canUndo && !game.isWon);
}

function handleTap(cell) {
  sound.unlock();
  if (mode === 'home' || !game || game.isWon) return;
  const arrow = game.arrowAt(cell.x, cell.y);
  if (!arrow) return;
  // Keep the lesson on track: only the glowing arrow responds.
  if (mode === 'tutorial' && arrow.id !== TUTORIAL_STEPS[tutorialStep]?.target) return;

  const result = game.tap(arrow.id);
  if (result.type === 'exit') {
    renderer.playExit(arrow, result.distance);
    sound.exit();
  } else {
    renderer.playBounce(arrow, result.distance);
    sound.bump();
    if (state.vibration) vibrate(18);
  }

  if (mode === 'tutorial') {
    advanceTutorial(result);
  } else {
    if (game.isWon) completeLevel();
    refresh();
  }
}

function completeLevel() {
  state.maxLevel = Math.max(state.maxLevel, Math.min(state.level + 1, LEVEL_COUNT));
  state.progressAt = Date.now();
  // Save as if already on the next level, so a reload continues from there.
  const current = state.level;
  state.level = nextLevel();
  persist();
  state.level = current;
  const isLast = state.level >= LEVEL_COUNT;
  // Let the last arrow finish leaving before celebrating.
  winTimer = setTimeout(() => {
    sound.win();
    ui.showWin({ moves: game.moves, isLast });
    ui.announce(isLast ? '¡Has completado todos los niveles!' : `¡Nivel ${state.level} completado!`);
  }, renderer.calm ? 150 : 700);
}

function undo() {
  if (mode !== 'play' || game.isWon || !game.undo()) return;
  renderer.clearHint();
  renderer.requestDraw();
  refresh();
}

function hint() {
  if (mode !== 'play' || game.isWon) return;
  const arrow = game.hint();
  if (arrow) renderer.showHint(arrow);
}

function restart() {
  if (mode !== 'play' || game.isWon) return;
  game.restart();
  sound.resetStreak();
  renderer.setGame(game);
  refresh();
}

// ---------- Startup ----------

darkQuery.addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && pushTimer) pushNow().catch(() => {});
});

attachInput(canvas, renderer, handleTap);
applySettings();
goHome();

// Reconnect players who were signed in last time; offline is fine, it just retries later.
if (cloud.cloudEnabled && state.account) ensureCloud().catch(() => {});
