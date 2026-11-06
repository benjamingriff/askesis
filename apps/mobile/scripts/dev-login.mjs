// Prints sign-in links for the local verification account (see docs/operations/local-development.md).
// A Clerk sign-in token signs the app straight in; it lasts ten minutes and is used once. Refuses
// anything but development keys. Treat the output as a credential: never commit or share it.
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { parseEnv } from 'node:util';

const rootEnv = new URL('../../../.env', import.meta.url);
const env = existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')) : {};
const secret = env.CLERK_SECRET_KEY ?? '';
if (!secret.startsWith('sk_test_')) {
  console.error(
    'dev-login only works with Clerk development keys (sk_test_) from `pnpm dev:setup`.',
  );
  process.exit(1);
}
const email = process.argv[2] ?? 'askesis-verification+clerk_test@example.com';
const clerk = async (path, init = {}) => {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Clerk ${path} failed with ${response.status}`);
  return response.json();
};

const [user] = await clerk(`/users?email_address=${encodeURIComponent(email)}&limit=1`);
if (!user) {
  console.error(`No Clerk user for ${email}. Run \`pnpm dev:setup\` first.`);
  process.exit(1);
}
const { token } = await clerk('/sign_in_tokens', {
  method: 'POST',
  body: JSON.stringify({ user_id: user.id, expires_in_seconds: 600 }),
});
const lan = Object.values(networkInterfaces())
  .flat()
  .find((address) => address?.family === 'IPv4' && !address.internal)?.address;
const ticket = encodeURIComponent(token);
console.log(
  JSON.stringify(
    {
      email,
      web: `http://localhost:8081/sign-in?ticket=${ticket}`,
      expoGo: lan ? `exp://${lan}:8081/--/sign-in?ticket=${ticket}` : null,
    },
    null,
    2,
  ),
);
