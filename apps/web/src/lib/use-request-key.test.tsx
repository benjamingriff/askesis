import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useRequestKey } from './use-request-key';

afterEach(cleanup);

it('retains keys across rerenders and returns to an earlier command signature', () => {
  const { result, rerender } = renderHook(useRequestKey);
  const command = { action: 'save', expectedEditNumber: 1, brief: { goal: 'Run a half' } };
  const original = result.current(command);
  expect(original).toEqual(expect.any(String));
  expect(original).not.toBe('');
  rerender();
  expect(result.current(structuredClone(command))).toBe(original);
  expect(result.current({ ...command, expectedEditNumber: 2 })).not.toBe(original);
  expect(result.current(command)).toBe(original);
});

it('keeps keys local to each mounted workflow and starts fresh after remounting', () => {
  const first = renderHook(useRequestKey);
  const second = renderHook(useRequestKey);
  const command = ['create', 'A plan'];
  const original = first.result.current(command);
  expect(second.result.current(command)).not.toBe(original);
  first.unmount();
  const remounted = renderHook(useRequestKey);
  expect(remounted.result.current(command)).not.toBe(original);
});

it('allocates a new key for a settled command while keeping others', () => {
  const { result } = renderHook(useRequestKey);
  const first = result.current(['record', 300]);
  const other = result.current(['record', 290]);
  result.current.settle(['record', 300]);
  expect(result.current(['record', 300])).not.toBe(first);
  expect(result.current(['record', 290])).toBe(other);
});
