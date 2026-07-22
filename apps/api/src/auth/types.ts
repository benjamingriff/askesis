export type AuthenticatedAthlete = {
  id: string;
  displayName: string;
  clerkUserId: string;
};

export type AppEnvironment = {
  Variables: {
    athlete: AuthenticatedAthlete;
  };
};
