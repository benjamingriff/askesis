/**
 * Training phases a block can serve, mirrored by a database check. A phase names the block's
 * purpose, not its place: a plan may hold several build blocks, and races sit inside phases.
 * - base: aerobic volume and durability, little intensity.
 * - build: progressively harder threshold and interval work on that base.
 * - peak: the most race-specific training, sharpening fitness for the goal event.
 * - taper: reduced volume with intensity kept, shedding fatigue before a race.
 * - recovery: easy absorption after a race or a hard block.
 */
export const BLOCK_PHASES = ['base', 'build', 'peak', 'taper', 'recovery'] as const;
export type BlockPhase = (typeof BLOCK_PHASES)[number];

/**
 * How much a race matters, mirrored by a database check. Only races carry a priority.
 * - A: a goal race, reached through a full taper block.
 * - B: an important tune-up, with a few easier days before it inside its block.
 * - C: raced as hard training, with no taper.
 */
export const RACE_PRIORITIES = ['A', 'B', 'C'] as const;
export type RacePriority = (typeof RACE_PRIORITIES)[number];
