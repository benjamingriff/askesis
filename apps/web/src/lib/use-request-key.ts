import { useRef } from 'react';

/**
 * Retains one request key per serialized command for this component's mounted lifetime, so an
 * uncertain retry reuses its key. Commands without a version in their input (the same body can
 * legitimately be sent again) call `settle` once they succeed, so the next send gets a new key.
 */
export function useRequestKey() {
  const keys = useRef(new Map<string, string>());
  const requestKey = (input: unknown) => {
    const signature = JSON.stringify(input);
    let key = keys.current.get(signature);
    if (key === undefined) {
      key = crypto.randomUUID();
      keys.current.set(signature, key);
    }
    return key;
  };
  requestKey.settle = (input: unknown) => void keys.current.delete(JSON.stringify(input));
  return requestKey;
}
