import { z } from 'zod';

// This is an explicit owner request for the existing Askesis deployment, not a
// default for other installations or accounts. Values are identifiers, not secrets.
export const hostedExampleTarget = {
  projectId: '53333778-0ea2-474b-8d18-8abcd2728a00',
  environmentId: 'a82a3e97-c194-4d45-b2a2-b1f1d3b81aae',
  email: 'drjamin1990@gmail.com',
} as const;

export class ExampleError extends Error {}

export function exampleEmail(value: string | undefined): string {
  const parsed = z.email().safeParse(value?.trim().toLowerCase());
  if (!parsed.success) throw new ExampleError('Provide a valid example owner email.');
  return parsed.data;
}

export function configuredExampleEmail(environment: NodeJS.ProcessEnv): string | null {
  const enabled = environment.EXAMPLE_PLAN_ENABLED;
  if (enabled && !['true', 'false'].includes(enabled))
    throw new ExampleError('EXAMPLE_PLAN_ENABLED must be true or false.');
  if (enabled === 'false') return null;
  const hosted =
    environment.NODE_ENV === 'production' &&
    environment.RAILWAY_PROJECT_ID === hostedExampleTarget.projectId &&
    environment.RAILWAY_ENVIRONMENT_ID === hostedExampleTarget.environmentId;
  if (enabled !== 'true' && !hosted) return null;
  return exampleEmail(
    environment.EXAMPLE_PLAN_EMAIL ?? (hosted ? hostedExampleTarget.email : undefined),
  );
}
