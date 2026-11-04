// Evidence references ("message:12", "workout:<id>", "turn:3") link reviewer
// judgements and flags to the exact place in the session they describe.

export function refTarget(ref: string): string | null {
  const [kind, ...rest] = ref.split(':');
  const value = rest.join(':');
  switch (kind) {
    case 'message':
      return `msg-${value}`;
    case 'workout':
      return `workout-${value}`;
    case 'turn':
      return `turn-${value}`;
    case 'belief':
      return `belief-${value}`;
    case 'block':
    case 'section':
      return value === 'plan' || kind === 'block' ? 'plan' : value;
    case 'plan':
      return 'beliefs';
    default:
      return null;
  }
}

export function refLabel(ref: string): string {
  const [kind, ...rest] = ref.split(':');
  const value = rest.join(':');
  if (kind === 'message') return `message ${value}`;
  if (kind === 'turn') return `turn ${value}`;
  if (kind === 'plan') return value === 'brief' ? 'plan brief' : `plan ${value}`;
  if (value.length > 10) return `${kind} ${value.slice(0, 6)}`;
  return `${kind} ${value}`;
}

/** Scrolls to the referenced element and briefly highlights it. */
export function focusRef(ref: string): boolean {
  const id = refTarget(ref);
  const element = id ? document.getElementById(id) : null;
  if (!element) return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.remove('flash');
  // Restart the highlight animation when the same target is chosen twice.
  void element.offsetWidth;
  element.classList.add('flash');
  window.setTimeout(() => element.classList.remove('flash'), 1800);
  return true;
}
