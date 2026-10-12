// Categorical slots validated with the dataviz palette checker against both the
// black and white surfaces (lightness band, chroma, CVD and normal-vision
// separation). A seventh model folds to a neutral rather than a generated hue.
const SERIES = ['#d06a42', '#3987e5', '#199e70', '#c98500', '#d55181', '#9085e9'];
const OVERFLOW = '#8a847e';

const REASONING_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'];
const REASONING_SHORT: Record<string, string> = {
  none: 'N',
  minimal: 'Mn',
  low: 'L',
  medium: 'M',
  high: 'H',
  xhigh: 'X',
  max: 'Mx',
  default: 'D',
};

/** Colour follows the model, never its rank in a filtered view. */
export function modelColors(models: Iterable<string>): Map<string, string> {
  const sorted = [...new Set(models)].sort((a, b) => a.localeCompare(b));
  return new Map(sorted.map((model, index) => [model, SERIES[index] ?? OVERFLOW]));
}

export function modelName(model: string): string {
  const claude = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  if (claude) return `${capitalize(claude[1] ?? '')} ${claude[2]}.${claude[3]}`;
  const gpt = /^gpt-([\d.]+)-?(.*)$/.exec(model);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${capitalize(gpt[2])}` : ''}`;
  return model
    .split('-')
    .map((part) => (/^\d/.test(part) ? part : capitalize(part)))
    .join(' ');
}

export function reasoningRank(reasoning: string): number {
  const index = REASONING_ORDER.indexOf(reasoning);
  return index === -1 ? REASONING_ORDER.length : index;
}

export function reasoningShort(reasoning: string): string {
  return REASONING_SHORT[reasoning] ?? reasoning.slice(0, 2).toUpperCase();
}

export function sortReasoning(levels: Iterable<string>): string[] {
  return [...new Set(levels)].sort((a, b) => reasoningRank(a) - reasoningRank(b));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
