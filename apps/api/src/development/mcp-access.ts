import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClerkClient } from '@clerk/backend';
import { closeDatabase } from '../database/client.js';
import { ensureAthlete } from '../auth/athlete-provisioning.js';
import {
  LocalVerificationError,
  verificationConfig,
  verificationEmail,
} from './verification-config.js';

/**
 * Mints development MCP access for one Clerk development user (the verification account unless
 * `--email` names another), writes it to the worktree's private .env and prints the Claude Code
 * command. Restart the API afterwards so it reads the new token.
 */
const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));

function upsertEnvironment(text: string, values: Record<string, string>) {
  const lines = text.split('\n').filter((line, index, all) => line || index < all.length - 1);
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const index = lines.findIndex((existing) => existing.startsWith(`${key}=`));
    if (index === -1) lines.push(line);
    else lines[index] = line;
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const config = verificationConfig(process.env);
  if (!existsSync(envPath))
    throw new LocalVerificationError('Run pnpm dev:setup to create the worktree .env first.');
  const flag = process.argv.indexOf('--email');
  const email = flag === -1 ? verificationEmail : process.argv[flag + 1];
  if (!email) throw new LocalVerificationError('Pass an address after --email.');
  const clerk = createClerkClient(config);
  const users = await clerk.users.getUserList({ emailAddress: [email], limit: 2 });
  if (users.data.length !== 1)
    throw new LocalVerificationError('Expected exactly one Clerk development user for that email.');
  const userId = users.data[0]!.id;
  await ensureAthlete(clerk, userId);
  const token = randomBytes(32).toString('base64url');
  writeFileSync(
    envPath,
    upsertEnvironment(readFileSync(envPath, 'utf8'), {
      MCP_DEV_TOKEN: token,
      MCP_DEV_CLERK_USER_ID: userId,
    }),
    { mode: 0o600 },
  );
  const port = process.env.API_PORT ?? process.env.PORT ?? '3000';
  // The token is a local credential: keep it out of commits, screenshots and shared logs.
  console.log(
    [
      `Development MCP access now acts as ${email}. Restart pnpm dev so the API reads it.`,
      'Connect Claude Code (replaces any earlier askesis server):',
      `  claude mcp remove askesis 2>/dev/null; claude mcp add --transport http askesis http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${token}"`,
    ].join('\n'),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  try {
    await main();
  } catch (error) {
    // Clerk error payloads can contain sensitive request details; never log them.
    console.error(
      error instanceof LocalVerificationError
        ? error.message
        : 'MCP access setup failed. Check development keys and database readiness.',
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
