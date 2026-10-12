export interface Scale {
  (value: number): number;
  ticks: number[];
}

export function linearScale(domain: [number, number], range: [number, number], count = 6): Scale {
  const [d0, d1] = domain[0] === domain[1] ? [domain[0] - 1, domain[1] + 1] : domain;
  const scale = ((value: number) =>
    range[0] + ((value - d0) / (d1 - d0)) * (range[1] - range[0])) as Scale;
  const step = niceStep((d1 - d0) / count);
  const ticks: number[] = [];
  for (let tick = Math.ceil(d0 / step) * step; tick <= d1 + step * 1e-6; tick += step) {
    ticks.push(Number(tick.toPrecision(12)));
  }
  scale.ticks = ticks;
  return scale;
}

export function logScale(domain: [number, number], range: [number, number]): Scale {
  const l0 = Math.log10(Math.max(domain[0], 1e-9));
  const l1 = Math.log10(Math.max(domain[1], domain[0] * 1.0001, 1e-9));
  const scale = ((value: number) =>
    range[0] +
    ((Math.log10(Math.max(value, 1e-9)) - l0) / (l1 - l0)) * (range[1] - range[0])) as Scale;
  const ticks: number[] = [];
  for (let power = Math.floor(l0); power <= Math.ceil(l1); power += 1) {
    for (const multiple of [1, 2, 5]) {
      const tick = multiple * 10 ** power;
      if (tick >= domain[0] * 0.999 && tick <= domain[1] * 1.001) ticks.push(tick);
    }
  }
  scale.ticks = ticks;
  return scale;
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

export function paddedDomain(values: number[], log: boolean): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (log) return [min / 1.35, max * 1.35];
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
  return [Math.max(0, min - pad), max + pad];
}
