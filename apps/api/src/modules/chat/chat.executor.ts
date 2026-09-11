import { getApiConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { sweepTestRuns } from './chat.service.js';

export function startTestExecutor() {
  let stopping = false;
  let pending: Promise<void> | null = null;
  if (getApiConfig().CHAT_EXECUTION_MODE !== 'test') return async () => {};
  function tick() {
    if (stopping || pending) return;
    pending = sweepTestRuns()
      .catch(() => {
        logger.error(
          'Test chat executor tick failed; pending runs will be checked on the next tick.',
        );
      })
      .finally(() => {
        pending = null;
      });
  }
  tick();
  const timer = setInterval(tick, 500);
  timer.unref();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await pending;
  };
}
