/* global fetch */
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';

// Pipe a short-lived Clerk session-token JSON object on stdin. Never print/store it.
const origin = process.argv[2];
if (!['http://localhost:5173', 'https://askesis.up.railway.app'].includes(origin)) {
  throw new Error('Choose the explicit local or Askesis production smoke target.');
}
let input = '';
for await (const chunk of process.stdin) input += chunk;
const token = JSON.parse(input).jwt;
if (typeof token !== 'string') throw new Error('Session token missing from stdin.');

async function request(path, method = 'GET', body, expectedStatus = 200) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (response.status !== expectedStatus)
    throw new Error(
      `${method} ${path}: ${response.status} (${data.error?.code ?? 'unexpected response'})`,
    );
  return data;
}
let plan = await request('/plans', 'POST', {
  displayName: `Phase 2 smoke ${new Date().toISOString()}`,
});
const path = `/plans/${plan.id}`;
const command = () => ({
  expectedStateVersion: plan.stateVersion,
  ...(plan.draft
    ? { expectedDraftId: plan.draft.id, expectedEditNumber: plan.draft.editNumber }
    : {}),
});
async function edit(description) {
  plan = await request(`${path}/draft`, 'PATCH', {
    expectedDraftId: plan.draft.id,
    expectedEditNumber: plan.draft.editNumber,
    description,
    startDate: '2026-09-01',
    endDate: '2026-10-01',
  });
}
async function lock() {
  const preview = await request(`${path}/validate`, 'POST');
  plan = await request(`${path}/lock`, 'POST', {
    ...command(),
    expectedContentHash: preview.contentHash,
    expectedValidationDigest: preview.validationDigest,
    acknowledgedWarningCodes: preview.findings
      .filter((finding) => finding.severity === 'warning')
      .map((finding) => finding.code),
  });
}
try {
  await request(`${path}/activate`, 'POST', { expectedStateVersion: plan.stateVersion }, 409);
  await edit('First smoke version');
  await lock();
  const first = plan.locked.id;
  plan = await request(`${path}/activate`, 'POST', { expectedStateVersion: plan.stateVersion });
  plan = await request(`${path}/unlock`, 'POST', { expectedStateVersion: plan.stateVersion });
  assert.equal(plan.active, true);
  await edit('Second smoke version');
  await lock();
  const second = plan.locked.id;
  const preview = await request(`${path}/revisions/${first}/restore-preview`, 'POST');
  plan = await request(`${path}/revisions/${first}/restore`, 'POST', {
    expectedStateVersion: preview.stateVersion,
    expectedCurrentVersionId: preview.currentVersionId,
    expectedSourceHash: preview.sourceHash,
  });
  assert.equal(plan.locked.id, second);
  assert.equal(plan.draft.basedOnVersionId, first);
  await lock();
  assert.equal(plan.locked.versionNumber, 3);
  assert.equal(plan.locked.basedOnVersionId, first);
  assert.equal(plan.locked.supersedesVersionId, second);
  assert.equal(
    (await request(`${path}/revisions/${first}`)).revision.description,
    'First smoke version',
  );
  assert.deepEqual(
    (await request(`${path}/revisions`)).revisions.map((revision) => revision.versionNumber),
    [3, 2, 1],
  );
  plan = await request(`${path}/unlock`, 'POST', { expectedStateVersion: plan.stateVersion });
  const draftId = plan.draft.id;
  plan = await request(`${path}/archive`, 'POST', { expectedStateVersion: plan.stateVersion });
  assert.equal((await request(`${path}/draft`)).version.id, draftId);
  assert.equal(plan.active, false);
  plan = await request(`${path}/unarchive`, 'POST', { expectedStateVersion: plan.stateVersion });
  assert.equal(plan.active, false);
  plan = await request(`${path}/discard`, 'POST', command());
  assert.equal(plan.draft, null);
  console.log(JSON.stringify({ lifecycle: 'passed', versions: 3, planId: plan.id }));
} finally {
  // Retain the smoke record in the archive; alpha deliberately has no delete API.
  plan = await request(path);
  if (!plan.archived)
    await request(`${path}/archive`, 'POST', { expectedStateVersion: plan.stateVersion });
  console.log('Smoke plan retained in archive.');
}
