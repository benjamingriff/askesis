import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { benchmarkResults } from './server/plugin';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, repositoryRoot, '');
  const resultsDirectory = path.resolve(
    repositoryRoot,
    environment.EVALS_RESULTS_DIR ?? process.env.EVALS_RESULTS_DIR ?? 'benchmark-results',
  );
  const port = Number(environment.EVALS_PORT ?? process.env.EVALS_PORT ?? 5179);

  return {
    plugins: [react(), benchmarkResults(resultsDirectory)],
    server: { host: '127.0.0.1', port, strictPort: false },
  };
});
