// Speed listening: the passage is played faster and faster and then back down, so that there is no time
// left to take a sentence apart word by word.
export const SPEED_LADDER = Object.freeze([1, 1.5, 2, 3, 2, 1.5, 1]);
/** How often each speed is played for a learner who needs longer to get used to a speed. */
export const REPEATS_WHEN_SLOW_TO_ADAPT = 3;

/**
 * One run as the plays it consists of. Each rung of the ladder is played `repeats` times;
 * `rung` counts rungs from 1.
 */
export function speedSteps(repeats = 1) {
  return SPEED_LADDER.flatMap((rate, index) => Array.from({ length: repeats }, () => ({ rate, rung: index + 1 })));
}
