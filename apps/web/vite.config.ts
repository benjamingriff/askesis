import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig, loadEnv } from 'vite';
import { z } from 'zod';

const WebBuildEnvironmentSchema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  VITE_API_BASE_URL: z.string().optional(),
  VITE_API_PROXY_TARGET: z.string().url().optional(),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  VITE_SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  VITE_SENTRY_RELEASE: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  SENTRY_ORG: z.string().min(1).optional(),
  SENTRY_PROJECT: z.string().min(1).optional(),
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

  const sentrySourceMapsEnabled =
    mode === 'production' &&
    result.data.SENTRY_AUTH_TOKEN !== undefined &&
    result.data.SENTRY_ORG !== undefined &&
    result.data.SENTRY_PROJECT !== undefined &&
    result.data.VITE_SENTRY_RELEASE !== undefined;

  return {
    plugins: [
      react(),
      ...(sentrySourceMapsEnabled
        ? [
            sentryVitePlugin({
              authToken: result.data.SENTRY_AUTH_TOKEN!,
              org: result.data.SENTRY_ORG!,
              project: result.data.SENTRY_PROJECT!,
              release: {
                name: result.data.VITE_SENTRY_RELEASE!,
                setCommits: false,
              },
              sourcemaps: {
                filesToDeleteAfterUpload: './dist/**/*.map',
              },
              telemetry: false,
            }),
          ]
        : []),
    ],
    build: {
      sourcemap: sentrySourceMapsEnabled ? 'hidden' : false,
    },
    server: {
      host: '0.0.0.0',
      port: result.data.WEB_PORT ?? 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: result.data.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
