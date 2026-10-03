import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountQueryProvider } from '../query-provider';
import { PlanDraftPage } from './plan-draft';
import { PlanPage } from './plans';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: mocks.get, POST: vi.fn(), PATCH: vi.fn() } }));
beforeEach(() => {
  localStorage.clear();
  mocks.get.mockReset();
});
afterEach(cleanup);

it.each(['draft', 'locked', 'inspection'])(
  'waits for coverage and recovers without false rest days in %s',
  async (view) => {
    const version = {
      id: 'version',
      state: view === 'locked' ? 'locked' : 'draft',
      versionNumber: view === 'locked' ? 1 : null,
      editNumber: 1,
      description: 'Training',
      startDate: '2027-01-11',
      endDate: '2027-01-24',
    };
    const plan = {
      id: 'plan',
      displayName: 'Training',
      stateVersion: 1,
      archived: false,
      active: false,
      draft: view === 'locked' ? null : version,
      locked: view === 'locked' ? version : null,
    };
    const brief = {
      versionId: version.id,
      editNumber: 1,
      startDate: version.startDate,
      endDate: version.endDate,
      confirmed: false,
      readOnly: view === 'locked',
      hash: 'h',
      scheduleReviewRequired: false,
      coverage: [{ startDate: '2027-01-11', endDate: '2027-01-12', current: true }],
      findings: [],
      calibrations: [],
      brief: { unit: 'kilometres', goal: 'Training' },
    };
    const workouts = [
      {
        id: 'w1',
        planId: 'plan',
        planVersionId: version.id,
        planTitle: 'Training',
        weekNumber: 1,
        scheduledDate: '2027-01-12',
        title: '6 km easy run',
        description: null,
        purpose: null,
        discipline: 'running',
        priority: 'medium',
        estimatedDurationSeconds: 2400,
        estimatedDistanceMetres: 6000,
      },
    ];
    let rejectBrief!: (error: Error) => void;
    const pendingBrief = new Promise((_, reject) => {
      rejectBrief = reject;
    });
    let coverageAvailable = false;
    mocks.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/brief')) return coverageAvailable ? { data: brief } : pendingBrief;
      return {
        data: path.endsWith('/draft')
          ? { version, findings: [], content: {} }
          : path === '/api/v1/workouts'
            ? { workouts }
            : path.endsWith('/revisions')
              ? { revisions: [] }
              : plan,
      };
    });
    const router = createMemoryRouter(
      [
        { path: '/plans/:planId', element: <PlanPage /> },
        { path: '/plans/:planId/draft', element: <PlanDraftPage /> },
      ],
      { initialEntries: [view === 'inspection' ? '/plans/plan/draft' : '/plans/plan'] },
    );
    render(
      <AccountQueryProvider>
        <RouterProvider router={router} />
      </AccountQueryProvider>,
    );
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith('/api/v1/workouts', expect.anything()),
    );
    expect(screen.queryByRole('heading', { name: 'Schedule' })).not.toBeInTheDocument();
    expect(screen.queryByText('Rest day')).not.toBeInTheDocument();
    rejectBrief(new Error('Coverage unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Coverage unavailable');
    expect(screen.queryByRole('heading', { name: 'Schedule' })).not.toBeInTheDocument();
    expect(screen.queryByText('Rest day')).not.toBeInTheDocument();
    coverageAvailable = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: /6 km easy run/ });
    expect(screen.getAllByText('Rest day')).toHaveLength(1);
    expect(screen.getAllByText('Not planned yet')).toHaveLength(5);
  },
);
