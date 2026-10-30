/** How long a deleted plan can be restored before it is purged. */
export const PLAN_RESTORE_DAYS = 30;
/** How long a requested account deletion can be cancelled. */
export const ACCOUNT_GRACE_DAYS = 7;
/** Long enough for any client retry of a command. */
export const IDEMPOTENCY_RETENTION_DAYS = 7;
/** Change notifications only need to bridge a client reconnecting. */
export const LIVE_EVENT_RETENTION_DAYS = 7;

export const DAY_MS = 86_400_000;

export const purgeDate = (from: Date | string, days: number) =>
  new Date(new Date(from).getTime() + days * DAY_MS).toISOString();
