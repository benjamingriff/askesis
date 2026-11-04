import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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
it('keeps unsaved input in the dialog when its aside opens and closes', () => {
  function Sheet() {
    const [aside, setAside] = useState(false);
    return (
      <Dialog open title="Feedback" onClose={() => {}} aside={aside ? <p>Reference</p> : undefined}>
        <button onClick={() => setAside(!aside)}>Toggle details</button>
        <input aria-label="Result" />
      </Dialog>
    );
  }
  render(<Sheet />);
  fireEvent.change(screen.getByLabelText('Result'), { target: { value: '41:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Toggle details' }));
  expect(screen.getByText('Reference')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle details' }));
  expect(screen.getByLabelText('Result')).toHaveValue('41:30');
});
