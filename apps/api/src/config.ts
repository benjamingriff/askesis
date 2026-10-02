import { z } from 'zod';

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
