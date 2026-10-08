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
