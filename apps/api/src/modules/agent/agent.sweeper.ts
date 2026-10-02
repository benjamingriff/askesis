import { getApiConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { pruneAgentWorkers, sweepAgentRuns } from './agent.service.js';

export function startAgentSweeper() {
  // Runs on every non-test mode: runs left active when agent mode is disabled must still be released.
  if (getApiConfig().CHAT_EXECUTION_MODE === 'test') return async () => {};
  let stopping = false;
  let pending: Promise<void> | undefined;
  let lastPrune = 0;
  const tick = () => {
    if (stopping || pending) return;
    const prune = Date.now() - lastPrune >= 60 * 60 * 1000;
    if (prune) lastPrune = Date.now();
    pending = sweepAgentRuns()
      .then(() => (prune ? pruneAgentWorkers() : undefined))
      .catch(() => logger.error('Agent execution cleanup failed.'))
      .finally(() => {
        pending = undefined;
      });
  };
  tick();
  const interval = setInterval(tick, 5000);
  interval.unref();
  return async () => {
    stopping = true;
    clearInterval(interval);
    await pending;
  };
}
