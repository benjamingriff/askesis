import { z } from 'zod';

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const ApiConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CHAT_EXECUTION_MODE: z.enum(['unavailable', 'test', 'agent']).default('unavailable'),
  AGENT_BOOTSTRAP_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).max(200).optional(),
  ),
  DATABASE_URL: z
    .string()
    .url()
    .regex(/^postgres(?:ql)?:\/\//),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_AUTHORIZED_PARTIES: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  SENTRY_RELEASE: z.string().optional(),
  // Activity connections. Strava stays unavailable until all three are set.
  STRAVA_CLIENT_ID: optional(z.string().regex(/^\d{1,20}$/)),
  STRAVA_CLIENT_SECRET: optional(z.string().min(8).max(200)),
  /** 32 random bytes, base64: encrypts provider tokens at rest. `openssl rand -base64 32` */
  INTEGRATION_ENCRYPTION_KEY: optional(
    z.string().refine((value) => Buffer.from(value, 'base64').length === 32),
  ),
  /** Overridable for the local Strava simulator; production requires HTTPS. */
  STRAVA_OAUTH_BASE_URL: z.string().url().default('https://www.strava.com'),
  STRAVA_API_BASE_URL: z.string().url().default('https://www.strava.com/api/v3'),
});

export type ApiConfig = Omit<z.infer<typeof ApiConfigSchema>, 'CLERK_PUBLISHABLE_KEY'> & {
  CLERK_PUBLISHABLE_KEY: string;
  clerkAuthorizedParties: string[] | undefined;
};

let cachedConfig: ApiConfig | undefined;

export function parseApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const result = ApiConfigSchema.safeParse(environment);
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join('.'))
      .filter(Boolean)
      .join(', ');
    throw new Error(
      `Invalid API environment configuration${fields.length > 0 ? `: ${fields}` : ''}`,
    );
  }

  const publishableKey =
    result.data.CLERK_PUBLISHABLE_KEY ?? result.data.VITE_CLERK_PUBLISHABLE_KEY;
  if (result.data.NODE_ENV === 'production' && result.data.CHAT_EXECUTION_MODE === 'test') {
    throw new Error('Test chat execution is forbidden in production.');
  }
  if (publishableKey === undefined) {
    throw new Error('Invalid API environment configuration: CLERK_PUBLISHABLE_KEY');
  }

  if (
    result.data.NODE_ENV === 'production' &&
    [result.data.STRAVA_OAUTH_BASE_URL, result.data.STRAVA_API_BASE_URL].some(
      (url) => !url.startsWith('https://'),
    )
  )
    throw new Error('Invalid API environment configuration: STRAVA_API_BASE_URL');

  if (result.data.CHAT_EXECUTION_MODE === 'agent' && !result.data.AGENT_BOOTSTRAP_TOKEN)
    throw new Error('Invalid API environment configuration: AGENT_BOOTSTRAP_TOKEN');
  const parties = result.data.CLERK_AUTHORIZED_PARTIES?.split(',')
    .map((party) => party.trim())
    .filter(Boolean);

  return {
    ...result.data,
    CLERK_PUBLISHABLE_KEY: publishableKey,
    clerkAuthorizedParties: parties === undefined || parties.length === 0 ? undefined : parties,
  };
}

export function getApiConfig(): ApiConfig {
  cachedConfig ??= parseApiConfig(process.env);
  return cachedConfig;
}

export function resetApiConfigForTests(): void {
  cachedConfig = undefined;
}
