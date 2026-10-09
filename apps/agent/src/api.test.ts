import { expect, it, vi } from 'vitest';
import { AgentApi, ApiError, type Claim } from './api.js';

const claim: Claim = {
  runId: '00000000-0000-4000-8000-000000000010',
  token: 'test-run-scoped-token',
  generation: 1,
  deadlineAt: '2026-10-09T16:00:00.000Z',
  versionId: '00000000-0000-4000-8000-000000000020',
  editNumber: 2,
};
const command = {
  operationId: '00000000-0000-4000-8000-000000000030',
  name: 'apply_schedule_changes',
  expectedVersionId: claim.versionId,
  expectedEditNumber: claim.editNumber,
  input: {
    blocks: [],
    weeks: [],
    workouts: [],
    deleteWorkoutIds: ['00000000-0000-4000-8000-000000000040'],
    deleteWeekIds: [],
    deleteBlockIds: [],
    generation: null,
    coverage: null,
  },
};
const result = {
  result: { deletedWorkoutIds: command.input.deleteWorkoutIds },
  versionId: claim.versionId,
  editNumber: 3,
  planId: '00000000-0000-4000-8000-000000000050',
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it('recovers from a tool 503 using the same operation, input, edit and scoped request', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ error: { code: 'TEMPORARILY_UNAVAILABLE' } }, 503))
    .mockResolvedValueOnce(response(result));
  const api = new AgentApi('http://localhost:3000/', fetcher);

  await expect(api.tool(claim, command, new AbortController().signal)).resolves.toEqual(result);

  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetcher.mock.calls) {
    expect(url).toBe(`http://localhost:3000/internal/agent/runs/${claim.runId}/tools`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: `Bearer ${claim.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
      redirect: 'error',
    });
  }
});

it.each(['network', '503'] as const)(
  'stops persistent tool %s failures after three attempts',
  async (failure) => {
    const networkError = new TypeError('Connection lost after commit');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (failure === 'network') throw networkError;
      return response({ error: { code: 'TEMPORARILY_UNAVAILABLE' } }, 503);
    });
    const api = new AgentApi('http://localhost:3000', fetcher);
    const delivery = api.tool(claim, command, new AbortController().signal);

    if (failure === 'network') {
      await expect(delivery).rejects.toBe(networkError);
    } else {
      await expect(delivery).rejects.toBeInstanceOf(ApiError);
      await expect(delivery).rejects.toMatchObject({
        code: 'TEMPORARILY_UNAVAILABLE',
        status: 503,
      });
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify(command),
      JSON.stringify(command),
      JSON.stringify(command),
    ]);
  },
);

it.each([
  { status: 401, code: 'AUTHENTICATION_REQUIRED' },
  { status: 409, code: 'LEASE_LOST' },
])(
  'does not retry a terminal tool $status/$code or expose its private payload',
  async ({ status, code }) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response(
          { error: { code, message: 'Private server detail', data: { secret: 'private' } } },
          status,
        ),
      );
    const api = new AgentApi('http://localhost:3000', fetcher);
    const delivery = api.tool(claim, command, new AbortController().signal);

    await expect(delivery).rejects.toBeInstanceOf(ApiError);
    await expect(delivery).rejects.toMatchObject({
      code,
      status,
      message: `Agent API rejected request: ${code}`,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

it('keeps malformed terminal error payloads out of tool exceptions', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response('Private non-JSON server detail', { status: 401 }),
    );
  const api = new AgentApi('http://localhost:3000', fetcher);

  await expect(api.tool(claim, command, new AbortController().signal)).rejects.toMatchObject({
    code: 'API_ERROR',
    status: 401,
    message: 'Agent API rejected request: API_ERROR',
  });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('does not retry a pending tool fetch that rejects after caller cancellation', async () => {
  const controller = new AbortController();
  const cancelled = new Error('Caller cancelled the tool');
  let rejectPending!: (reason: unknown) => void;
  const pending = new Promise<Response>((_resolve, reject) => {
    rejectPending = reject;
  });
  // Unexpected retries reject immediately, making a missing abort guard fail without hanging.
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(cancelled).mockReturnValueOnce(pending);
  const api = new AgentApi('http://localhost:3000', fetcher);
  const delivery = api.tool(claim, command, controller.signal);
  const rejection = expect(delivery).rejects.toBe(cancelled);

  expect(fetcher).toHaveBeenCalledOnce();
  const fetchSignal = fetcher.mock.calls[0]![1]?.signal;
  expect(fetchSignal).toBeInstanceOf(AbortSignal);
  expect(fetchSignal?.aborted).toBe(false);
  controller.abort(cancelled);
  expect(fetchSignal?.aborted).toBe(true);
  expect(fetchSignal?.reason).toBe(cancelled);
  rejectPending(cancelled);

  await rejection;
  expect(fetcher).toHaveBeenCalledOnce();
});
