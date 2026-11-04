export type AuthenticatedAthlete = {
  id: string;
  displayName: string;
  clerkUserId: string;
  /** IANA timezone of the device the athlete last used. */
  timezone: string;
  /** The athlete asked to delete the account; only account routes remain available. */
  deletionPending: boolean;
};

export type AppEnvironment = {
  Variables: {
    athlete: AuthenticatedAthlete;
    requestId: string;
  };
};
