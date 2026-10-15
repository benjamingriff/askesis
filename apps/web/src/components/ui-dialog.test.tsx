import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './ui';
afterEach(cleanup);
it('Escape closes only the top dialog when feedback opens over workout details', () => {
  const outer = vi.fn(),
    inner = vi.fn();
  render(
    <>
      <Dialog open title="Workout" onClose={outer}>
        <button>Open feedback</button>
      </Dialog>
      <Dialog open title="Feedback" onClose={inner}>
        <button>Save feedback</button>
      </Dialog>
    </>,
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(inner).toHaveBeenCalledOnce();
  expect(outer).not.toHaveBeenCalled();
});
it('restores page scrolling when navigation unmounts both dialogs together', () => {
  document.body.style.overflow = 'auto';
  const view = render(
    <>
      <Dialog open title="Workout" onClose={() => {}} />
      <Dialog open title="Feedback" onClose={() => {}} />
    </>,
  );
  expect(document.body.style.overflow).toBe('hidden');
  view.unmount();
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});
