import { describe, expect, it } from 'vitest';
import { voiceProblems } from './voice.js';

const statements = [
  'For the last 6 weeks I have run 3 times per week, about 22 km total per week. My longest recent run is 9 km.',
  'I can train only on these days: Tuesday: up to 60 minutes; Sunday: up to 100 minutes (preferred). All other days are unavailable.',
  'Start on 2026-10-19; the overall plan ends 2027-01-10.',
];

describe('voice validation', () => {
  it('accepts reworded facts with every figure, date and weekday intact', () => {
    expect(
      voiceProblems(
        'Honestly? Six weeks of 3 runs a week, roughly 22k, longest 9k. Only Tues (60 mins max) and Sun (up to 100) work. Start 2026-10-19, finish 2027-01-10. Is that enough?',
        statements,
      ),
    ).toEqual([]);
  });
  it('rejects added figures, weekdays and dates', () => {
    const problems = voiceProblems(
      '6 weeks, 3 runs, 22 km, longest 9 km, though I once did 30. Tuesday 60, Sunday 100, maybe Friday too. 2026-10-19 to 2027-01-10, race 2027-01-17.',
      statements,
    );
    expect(problems.join(' ')).toContain('numbers not in the statements: 30');
    expect(problems.join(' ')).toContain('weekdays not in the statements: friday');
    expect(problems.join(' ')).toContain('2027-01-17');
  });
  it('rejects a message that drops a disclosed value or is empty', () => {
    expect(
      voiceProblems('About 22 km over 3 runs for 6 weeks. Tue and Sun only.', statements).join(' '),
    ).toContain('Missing numbers: 9, 60, 100');
    expect(voiceProblems('  ', statements)).toEqual(['The message is empty.']);
  });
});
