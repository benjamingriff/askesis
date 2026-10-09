import { mkdir, writeFile, rename, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import type { Check } from './checks.js';
import type { Review } from './models.js';

// Defense in depth: exported state is explicitly selected, and credentials are never captured.
export function redact(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(?:authorization|headers|token|credential_digest|secret|apiKey|OPENAI_API_KEY|CLERK_SECRET_KEY|AGENT_BOOTSTRAP_TOKEN|DATABASE_URL)$/i.test(
              key,
            ),
        )
        .map(([key, item]) => [key, redact(item)]),
    );
  return value;
}

export class Artifacts {
  constructor(readonly directory: string) {}
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }
  async json(name: string, value: unknown) {
    const path = resolve(this.directory, name);
    await writeFile(`${path}.tmp`, JSON.stringify(redact(value), null, 2) + '\n', { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  async event(event: Record<string, unknown>) {
    await appendFile(
      resolve(this.directory, 'progress.jsonl'),
      JSON.stringify(redact({ at: new Date().toISOString(), ...event })) + '\n',
      { mode: 0o600 },
    );
  }
  async snapshot(snapshot: BenchmarkSnapshot) {
    await this.json('snapshot.json', snapshot);
    await this.json('conversation.json', snapshot.messages);
    await this.json('plan.json', snapshot.plan);
    await this.json('performance.json', snapshot.performance);
  }
}

export function reportMarkdown(
  runId: string,
  verdict: string,
  stopReason: string,
  snapshot: BenchmarkSnapshot | null,
  checks: Check[],
  review: Review | null,
  scripted: boolean,
) {
  const lines = [
    `# Benchmark ${runId}`,
    '',
    `Overall assessment: **${verdict}**`,
    '',
    `Execution: ${stopReason}. ${scripted ? '**Scripted verification: no live model quality was evaluated.**' : 'Synthetic scenario; model review is provisional and has not been calibrated by a coach.'}`,
    '',
    review?.summary ?? 'No model assessment is available.',
    '',
    '## Deterministic checks',
    '',
    ...checks.map(
      (check) =>
        `- **${check.status} — ${check.id}**: ${check.explanation}${check.evidence.length ? ` (${check.evidence.join(', ')})` : ''}`,
    ),
    '',
    '## Reviewer findings',
    '',
    ...(review?.criteria.map(
      (item) =>
        `- **${item.result} — ${item.criterion}**: ${item.explanation} (${item.evidence.join(', ')})`,
    ) ?? ['Review was not completed.']),
    '',
    '## Saved schedule',
    '',
    '| Date | Workout | Distance estimate |',
    '| --- | --- | --- |',
  ];
  const escape = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const { workout } of snapshot?.plan?.workouts ?? [])
    lines.push(
      `| ${workout.scheduledDate} | ${escape(workout.title)} | ${workout.estimatedDistanceMetres === null ? 'Unknown' : `${workout.estimatedDistanceMetres / 1000} km`} |`,
    );
  lines.push('', '## Conversation', '');
  for (const message of snapshot?.messages ?? [])
    lines.push(`### ${message.role} — message:${message.sequence}`, '', message.content, '');
  lines.push(
    '## Detailed evidence',
    '',
    '[Plan and prescriptions](plan.json) · [Full snapshot and durable outputs](snapshot.json) · [Tool trace](tool-trace.jsonl) · [Assessment](assessment.json) · [Progress](progress.jsonl) · [Configuration](configuration.json) · [Manifest](manifest.json)',
    '',
    'Token usage is recorded when available in metrics.json. Monetary cost is unknown; failed calls may have incomplete usage.',
    '',
  );
  return lines.join('\n');
}
