import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { z } from 'zod';

const WebBuildEnvironmentSchema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  VITE_API_BASE_URL: z.string().optional(),
  VITE_API_PROXY_TARGET: z.string().url().optional(),
  VITE_SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  VITE_SENTRY_RELEASE: z.string().optional(),
});

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const result = WebBuildEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join('.'))
      .filter(Boolean)
      .join(', ');
    throw new Error(`Invalid web build environment${fields.length > 0 ? `: ${fields}` : ''}`);
  }

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: result.data.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
