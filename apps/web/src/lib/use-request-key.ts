import { useRef } from 'react';

/** Retains one request key per serialized command for this component's mounted lifetime. */
export function useRequestKey() {
  const keys = useRef(new Map<string, string>());
  return (input: unknown) => {
    const signature = JSON.stringify(input);
    let key = keys.current.get(signature);
    if (key === undefined) {
      key = crypto.randomUUID();
      keys.current.set(signature, key);
    }
    return key;
  };
}
