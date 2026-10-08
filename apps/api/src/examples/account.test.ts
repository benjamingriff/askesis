import type { ClerkClient } from '@clerk/backend';
import { expect, it, vi } from 'vitest';
import { ensureAthlete } from '../auth/athlete-provisioning.js';
import { exampleOwner } from './account.js';

vi.mock('../auth/athlete-provisioning.js', () => ({
  ensureAthlete: vi.fn(async () => ({ id: 'original-athlete' })),
}));
const user = {
  id: 'user_owner',
  emailAddresses: [{ emailAddress: 'Owner@Example.com', verification: { status: 'verified' } }],
};
const client = (data: unknown[], totalCount = data.length) =>
  ({ users: { getUserList: vi.fn(async () => ({ data, totalCount })) } }) as unknown as ClerkClient;

it('uses normal provisioning for the exact verified owner, retaining existing identity', async () => {
  const clerk = client([user]);
  expect(await exampleOwner(clerk, 'owner@example.com')).toEqual({ id: 'original-athlete' });
  expect(ensureAthlete).toHaveBeenCalledWith(clerk, 'user_owner');
});

it('refuses missing, ambiguous, truncated and unverified account matches', async () => {
  await expect(exampleOwner(client([]), 'owner@example.com')).rejects.toThrow('exactly one');
  await expect(exampleOwner(client([user, user]), 'owner@example.com')).rejects.toThrow(
    'exactly one',
  );
  await expect(exampleOwner(client([user], 2), 'owner@example.com')).rejects.toThrow('exactly one');
  await expect(
    exampleOwner(client([{ ...user, emailAddresses: [] }]), 'owner@example.com'),
  ).rejects.toThrow('verified matching');
});
