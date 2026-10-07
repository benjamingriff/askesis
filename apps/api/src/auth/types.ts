export type AuthenticatedAthlete = {
  id: string;
  displayName: string;
  clerkUserId: string;
  /** IANA timezone of the device the athlete last used. */
  timezone: string;
};

export type AppEnvironment = {
  Variables: {
    athlete: AuthenticatedAthlete;
    requestId: string;
  };
};
