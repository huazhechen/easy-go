import type { Player } from '../../types';
import { BLACK, WHITE, type StoneColor } from './fastBoard';

/** App-level player colour to the engine's compact stone representation. */
export const playerToColor = (player: Player): StoneColor => (player === 'black' ? BLACK : WHITE);

/** Engine stone representation back to the app-level player colour. */
export const colorToPlayer = (color: StoneColor): Player => (color === BLACK ? 'black' : 'white');
