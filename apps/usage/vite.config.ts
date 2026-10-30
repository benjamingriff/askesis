import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, repositoryRoot, '');
  const port = Number(environment.USAGE_PORT ?? process.env.USAGE_PORT ?? 5189);

  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port, strictPort: true },
  };
});
