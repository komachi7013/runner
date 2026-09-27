export type GameAction = 'jump' | 'start' | 'restart';

export const isJumpKey = (event: KeyboardEvent): boolean =>
  event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW';
