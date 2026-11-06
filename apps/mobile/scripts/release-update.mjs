// Publishes the app's current JavaScript to installed production (TestFlight) builds with EAS
// Update: `pnpm release:update "What changed"` from apps/mobile.
//
// `eas update` bundles on this machine and ignores the `env` block of eas.json's build profiles,
// so the production build's EXPO_PUBLIC_* values are passed through here. Without them the update
// would ship with no API URL and the app would look for a local Metro server.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const message = process.argv.slice(2).join(' ').trim();
if (!message) {
  console.error('Usage: pnpm release:update "What changed"');
  process.exit(1);
}

const result = spawnSync(
  'npx',
  [
    'eas-cli',
    'update',
    '--channel',
    'production',
    '--environment',
    'production',
    '--platform',
    'ios',
    '--message',
    message,
  ],
  { cwd: app, stdio: 'inherit', env: { ...process.env, ...eas.build.production.env } },
);
process.exit(result.status ?? 1);
