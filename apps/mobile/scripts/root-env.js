// The repository's root .env (written by `pnpm dev:setup`), read by the Expo and Metro configs
// so a plain `npx expo start` uses this checkout's Clerk key and local API.
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');

const file = resolve(__dirname, '../../../.env');

module.exports = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
