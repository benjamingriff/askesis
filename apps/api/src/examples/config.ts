import { z } from 'zod';

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
  if (enabled !== 'true') return null;
  return exampleEmail(environment.EXAMPLE_PLAN_EMAIL);
}
