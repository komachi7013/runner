export type RunPhase = 'ready' | 'running' | 'stageclear' | 'gameover' | 'complete';

export interface RunSnapshot {
  phase: RunPhase;
  score: number;
  coins: number;
  best: number;
  speed: number;
  stage: number;
  stageDistance: number;
  stageProgress: number;
  retriesRemaining: number;
}

const BEST_KEY = 'skybound-sprint-best';
export const COIN_SCORE = 100;
export const FINAL_STAGE = 3;
export const MAX_RETRIES = 3;
export const STAGE_DISTANCES = [1500, 1500, 2000] as const;

export function getStageDistance(stage: number): number {
  return STAGE_DISTANCES[Math.max(0, Math.min(FINAL_STAGE - 1, stage - 1))];
}

export class RunState {
  private phase: RunPhase = 'ready';
  private stage = 1;
  private stageDistance = 0;
  private totalDistance = 0;
  private coins = 0;
  private best = Number(localStorage.getItem(BEST_KEY) ?? 0);
  private speed = 300;
  private retriesRemaining = MAX_RETRIES;
  private checkpointTotalDistance = 0;
  private checkpointCoins = 0;

  start(): void {
    this.phase = 'running';
    this.stage = 1;
    this.stageDistance = 0;
    this.totalDistance = 0;
    this.coins = 0;
    this.speed = 300;
    this.retriesRemaining = MAX_RETRIES;
    this.checkpointTotalDistance = 0;
    this.checkpointCoins = 0;
  }

  update(deltaSeconds: number): void {
    if (this.phase !== 'running') return;
    const targetDistance = getStageDistance(this.stage);
    const travelled = Math.min(this.speed * deltaSeconds * 0.1, targetDistance - this.stageDistance);
    this.stageDistance += travelled;
    this.totalDistance += travelled;
    if (this.stage === FINAL_STAGE) this.speed = 440 + 210 * (this.stageDistance / targetDistance);
    if (this.stageDistance >= targetDistance) {
      this.phase = this.stage === FINAL_STAGE ? 'complete' : 'stageclear';
      this.updateBest();
    }
  }

  advanceStage(): void {
    if (this.phase !== 'stageclear') return;
    this.stage += 1;
    this.stageDistance = 0;
    this.speed = 440;
    this.checkpointTotalDistance = this.totalDistance;
    this.checkpointCoins = this.coins;
    this.phase = 'running';
  }

  retryStage(): boolean {
    if (this.phase !== 'gameover' || this.retriesRemaining <= 0) return false;
    this.retriesRemaining -= 1;
    this.stageDistance = 0;
    this.totalDistance = this.checkpointTotalDistance;
    this.coins = this.checkpointCoins;
    this.speed = this.stage === 1 ? 300 : 440;
    this.phase = 'running';
    return true;
  }

  collectCoin(): void {
    if (this.phase !== 'running') return;
    this.coins += 1;
  }

  end(): void {
    if (this.phase !== 'running') return;
    this.phase = 'gameover';
    this.updateBest();
  }

  getScore(): number {
    return Math.floor(this.totalDistance) + this.coins * COIN_SCORE;
  }

  snapshot(): RunSnapshot {
    const targetDistance = getStageDistance(this.stage);
    return { phase: this.phase, score: this.getScore(), coins: this.coins, best: this.best, speed: this.speed, stage: this.stage, stageDistance: this.stageDistance, stageProgress: this.stageDistance / targetDistance, retriesRemaining: this.retriesRemaining };
  }

  private updateBest(): void {
    const score = this.getScore();
    if (score > this.best) {
      this.best = score;
      localStorage.setItem(BEST_KEY, String(score));
    }
  }
}
