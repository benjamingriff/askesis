import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AskAgentProvider, StartPlanButton } from './AskAgent';
import type * as Coach from '../coach';

const coach = vi.hoisted(() => ({ enabled: true }));
vi.mock('../coach', async (original) => ({
  ...(await original<typeof Coach>()),
  useInAppCoach: () => coach.enabled,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  coach.enabled = true;
});

function renderStart() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <AskAgentProvider>
            <StartPlanButton coachLabel="Talk to your coach" />
          </AskAgentProvider>
        ),
      },
      { path: '/chat', element: <h1>Coach</h1> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

it('starts a plan in chat when the in-app coach is offered', () => {
  renderStart();
  fireEvent.click(screen.getByRole('link', { name: 'Talk to your coach' }));
  expect(screen.getByRole('heading', { name: 'Coach' })).toBeInTheDocument();
});

it('copies a starting prompt for the athlete’s agent when the coach is hidden', async () => {
  coach.enabled = false;
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  renderStart();
  fireEvent.click(screen.getByRole('button', { name: 'Ask your agent' }));
  const dialog = screen.getByRole('dialog', { name: 'Ask your agent' });
  const prompt = within(dialog).getByLabelText('Prompt for your agent') as HTMLTextAreaElement;
  expect(prompt.value).toMatch(/^Using Askesis: Help me build a training plan\./);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt.value));
  expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps the prompt on screen to copy by hand when the clipboard refuses', async () => {
  coach.enabled = false;
  const writeText = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  renderStart();
  fireEvent.click(screen.getByRole('button', { name: 'Ask your agent' }));
  const dialog = screen.getByRole('dialog', { name: 'Ask your agent' });
  expect(await within(dialog).findByRole('status')).toHaveTextContent(
    'Select the prompt and copy it, then paste it into your agent.',
  );
  expect(within(dialog).getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument();
  writeText.mockResolvedValueOnce(undefined);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy prompt' }));
  expect(await within(dialog).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});
