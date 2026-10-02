import { getApiConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { sweepAgentRuns } from './agent.service.js';

export function startAgentSweeper() {
  if (getApiConfig().CHAT_EXECUTION_MODE === 'test') return async () => {};
  let stopping = false;
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (stopping || pending) return;
    pending = sweepAgentRuns()
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
