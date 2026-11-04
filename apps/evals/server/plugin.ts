import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { loadIndex, loadRunDetail, resultsRootExists, saveHighlights, saveReview } from './results';

const MAX_BODY = 64 * 1024;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

// Serves normalized benchmark artifacts to the dev server only. The results
// directory is read on every request so new runs appear without a restart.
export function benchmarkResults(root: string): Plugin {
  const resolvedRoot = path.resolve(root);
  return {
    name: 'askesis-benchmark-results',
    configureServer(server) {
      server.middlewares.use('/api', (request, response, next) => {
        void (async () => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          const send = (status: number, body: unknown) => {
            response.statusCode = status;
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Cache-Control', 'no-store');
            response.end(JSON.stringify(body));
          };

          if (url.pathname === '/index') {
            if (!(await resultsRootExists(resolvedRoot))) {
              send(404, { error: 'results_directory_missing', root: resolvedRoot });
              return;
            }
            send(200, await loadIndex(resolvedRoot));
            return;
          }

          const reviewMatch = /^\/runs\/([^/]+)\/review$/.exec(url.pathname);
          if (reviewMatch?.[1] && request.method === 'PUT') {
            let payload: unknown;
            try {
              payload = JSON.parse(await readBody(request));
            } catch {
              send(400, { error: 'invalid_json' });
              return;
            }
            const saved = await saveReview(
              resolvedRoot,
              decodeURIComponent(reviewMatch[1]),
              payload,
            );
            if (saved === 'not_found') send(404, { error: 'run_not_found' });
            else if (saved === 'invalid') send(400, { error: 'invalid_review' });
            else send(200, saved);
            return;
          }

          const highlightsMatch = /^\/runs\/([^/]+)\/highlights$/.exec(url.pathname);
          if (highlightsMatch?.[1] && request.method === 'PUT') {
            let payload: unknown;
            try {
              payload = JSON.parse(await readBody(request));
            } catch {
              send(400, { error: 'invalid_json' });
              return;
            }
            const saved = await saveHighlights(
              resolvedRoot,
              decodeURIComponent(highlightsMatch[1]),
              payload,
            );
            if (saved === 'not_found') send(404, { error: 'run_not_found' });
            else if (saved === 'invalid') send(400, { error: 'invalid_highlights' });
            else send(200, saved);
            return;
          }

          const match = /^\/runs\/([^/]+)$/.exec(url.pathname);
          if (match?.[1]) {
            const detail = await loadRunDetail(resolvedRoot, decodeURIComponent(match[1]));
            if (detail) send(200, detail);
            else send(404, { error: 'run_not_found' });
            return;
          }
          next();
        })().catch(next);
      });
    },
  };
}
