/// <reference types="vite/client" />

import Phaser from 'phaser';
import { GameScene } from './phaser/scenes/GameScene';
import './styles.css';

declare global {
  interface Window {
    __skyboundSprintGame?: Phaser.Game;
    __skyboundSprintEvents?: AbortController;
  }
}

window.__skyboundSprintEvents?.abort();
window.__skyboundSprintGame?.destroy(true);
document.querySelector('#game')?.replaceChildren();
const eventController = new AbortController();
window.__skyboundSprintEvents = eventController;

const scoreEl = document.querySelector('#score')!;
const coinsEl = document.querySelector('#coins')!;
const bestEl = document.querySelector('#best')!;
const stageEl = document.querySelector('#stage')!;
const retriesEl = document.querySelector('#retries')!;
const progressEl = document.querySelector<HTMLElement>('#course-progress span')!;
const stageBanner = document.querySelector<HTMLElement>('#stage-banner')!;
const startPanel = document.querySelector('#start-panel')!;
const gameoverPanel = document.querySelector('#gameover-panel')!;
const completePanel = document.querySelector('#complete-panel')!;
const completeTitle = document.querySelector('#complete-title')!;
const completeImage = document.querySelector<HTMLImageElement>('#complete-image')!;
const completeMessage = document.querySelector('#complete-message')!;
const completeScore = document.querySelector('#complete-score')!;
const completeCoins = document.querySelector('#complete-coins')!;
const finalScore = document.querySelector('#final-score')!;
const finalCoins = document.querySelector('#final-coins')!;
const gameoverTitle = document.querySelector('#gameover-title')!;
const gameoverMessage = document.querySelector('#gameover-message')!;
const retryButton = document.querySelector<HTMLButtonElement>('#retry-button')!;
const soundButton = document.querySelector<HTMLButtonElement>('#sound-button')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-button')!;
const pausePanel = document.querySelector('#pause-panel')!;
const resumeButton = document.querySelector<HTMLButtonElement>('#resume-button')!;
const jumpHint = document.querySelector('#jump-hint')!;

let scene: GameScene;
let soundEnabled = true;
let paused = false;
let canRetryStage = false;
const portraitPhone = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
let pausedForOrientation = false;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#101535',
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: GameScene,
  render: { antialias: true, pixelArt: false },
  callbacks: {
    postBoot: () => {
      scene = game.scene.getScene('game') as GameScene;
      scene.setGameEvents({
        onUpdate: (score: number, coins: number, best: number, stage: number, progress: number, retriesRemaining: number) => {
          scoreEl.textContent = String(score).padStart(5, '0');
          coinsEl.textContent = String(coins).padStart(2, '0');
          bestEl.textContent = String(best).padStart(5, '0');
          stageEl.textContent = `${stage} / 3`;
          retriesEl.textContent = String(retriesRemaining);
          progressEl.style.width = `${Math.round(progress * 100)}%`;
        },
        onStageClear: (stage: number) => {
          stageBanner.textContent = `${stage}面 ゴール！　次は${stage + 1}面`;
          stageBanner.classList.add('visible');
          window.setTimeout(() => stageBanner.classList.remove('visible'), 1200);
        },
        onComplete: (score: number, coins: number) => {
          const clearedTarget = score >= 20000;
          completeTitle.textContent = clearedTarget ? '全3面 走破！' : 'あと一歩…！';
          completeMessage.textContent = clearedTarget ? '20000点達成！ 最高の走り！' : '目標は20000点。もう一度挑戦！';
          completeImage.src = clearedTarget ? '/assets/results/runner-victory.png' : '/assets/results/runner-frustrated.png';
          completeImage.alt = clearedTarget
            ? '汗をかきながら走破を喜ぶランナー'
            : '四つん這いになって悔しがるランナー';
          completeScore.textContent = String(score).padStart(5, '0');
          completeCoins.textContent = `コイン ${coins} 枚`;
          completePanel.classList.add('visible');
          finishUiState();
        },
        onGameOver: (score: number, coins: number, stage: number, retriesRemaining: number) => {
          finalScore.textContent = String(score).padStart(5, '0');
          finalCoins.textContent = `コイン ${coins} 枚`;
          canRetryStage = retriesRemaining > 0;
          gameoverTitle.textContent = canRetryStage ? `${stage}面の最初から再挑戦` : 'リトライを使い切りました';
          gameoverMessage.textContent = canRetryStage
            ? `残り${retriesRemaining}回。スコアとコインは面の開始時点に戻ります。`
            : '次は1面から新しく挑戦します。';
          retryButton.innerHTML = canRetryStage ? 'この面をやり直す <span>↻</span>' : '1面から再挑戦 <span>↻</span>';
          gameoverPanel.classList.add('visible');
          finishUiState();
        },
      });
    },
  },
});
window.__skyboundSprintGame = game;

function finishUiState(): void {
  jumpHint.classList.remove('visible');
  paused = false;
  pausePanel.classList.remove('visible');
  pauseButton.disabled = true;
  pauseButton.textContent = 'Ⅱ';
  pauseButton.setAttribute('aria-pressed', 'false');
}

function setPaused(nextPaused: boolean): void {
  if (!scene?.isRunning()) return;
  paused = nextPaused;
  if (paused) {
    scene.setPaused(true);
    scene.scene.pause();
  } else {
    scene.scene.resume();
    scene.setPaused(false);
  }
  pausePanel.classList.toggle('visible', paused);
  pauseButton.textContent = paused ? '▶' : 'Ⅱ';
  pauseButton.setAttribute('aria-label', paused ? 'ゲームを再開' : '一時停止');
  pauseButton.setAttribute('aria-pressed', String(paused));
}

function syncOrientation(): void {
  if (portraitPhone.matches) {
    if (scene?.isRunning() && !paused) {
      setPaused(true);
      pausedForOrientation = true;
    }
  } else if (pausedForOrientation) {
    pausedForOrientation = false;
    setPaused(false);
  }
  game.scale.refresh();
}

function beginRun(): void {
  if (portraitPhone.matches) return;
  pausedForOrientation = false;
  if (paused) setPaused(false);
  startPanel.classList.remove('visible');
  gameoverPanel.classList.remove('visible');
  completePanel.classList.remove('visible');
  stageBanner.classList.remove('visible');
  stageEl.textContent = '1 / 3';
  progressEl.style.width = '0%';
  pausePanel.classList.remove('visible');
  pauseButton.disabled = false;
  jumpHint.classList.add('visible');
  window.setTimeout(() => jumpHint.classList.remove('visible'), 2400);
  scene.events.emit('start-run');
}

function retry(): void {
  if (portraitPhone.matches) return;
  if (!canRetryStage) {
    beginRun();
    return;
  }
  gameoverPanel.classList.remove('visible');
  stageBanner.classList.remove('visible');
  pauseButton.disabled = false;
  jumpHint.classList.add('visible');
  window.setTimeout(() => jumpHint.classList.remove('visible'), 1600);
  canRetryStage = false;
  scene.retryStage();
}

document.querySelector('#start-button')?.addEventListener('click', beginRun, { signal: eventController.signal });
retryButton.addEventListener('click', retry, { signal: eventController.signal });
document.querySelector('#complete-retry-button')?.addEventListener('click', beginRun, { signal: eventController.signal });
pauseButton.addEventListener('click', () => setPaused(!paused), { signal: eventController.signal });
resumeButton.addEventListener('click', () => setPaused(false), { signal: eventController.signal });
portraitPhone.addEventListener('change', syncOrientation, { signal: eventController.signal });
window.addEventListener('resize', () => game.scale.refresh(), { signal: eventController.signal });

soundButton.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundButton.textContent = soundEnabled ? '♪' : '×';
  soundButton.classList.toggle('muted', !soundEnabled);
  scene.events.emit('toggle-sound', soundEnabled);
}, { signal: eventController.signal });

window.addEventListener('keydown', (event) => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(event.code)) event.preventDefault();
  if (['KeyP', 'Escape'].includes(event.code) && !startPanel.classList.contains('visible') && !gameoverPanel.classList.contains('visible') && !completePanel.classList.contains('visible')) {
    event.preventDefault();
    setPaused(!paused);
  }
  if (event.code === 'Enter' && gameoverPanel.classList.contains('visible')) retry();
  else if (event.code === 'Enter' && (startPanel.classList.contains('visible') || completePanel.classList.contains('visible'))) beginRun();
}, { passive: false, signal: eventController.signal });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    eventController.abort();
    game.destroy(true);
    if (window.__skyboundSprintGame === game) window.__skyboundSprintGame = undefined;
    if (window.__skyboundSprintEvents === eventController) window.__skyboundSprintEvents = undefined;
  });
}
