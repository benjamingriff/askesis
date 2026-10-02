import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChatMarkdown } from './ChatMarkdown';

afterEach(cleanup);

it('renders a coaching reply with headings, emphasis, lists and a schedule table', () => {
  const { container } = render(
    <ChatMarkdown
      content={
        '## First four weeks\n\nKeep **easy effort**.\n\n- Tuesday: 6 km\n- Sunday: 8 km\n\n| Week | Distance |\n| --- | --- |\n| 1 | 20 km |'
      }
    />,
  );
  expect(screen.getByRole('heading', { name: 'First four weeks' })).toBeInTheDocument();
  expect(container.querySelector('strong')).toHaveTextContent('easy effort');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '20 km' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Message table' })).toHaveAttribute('tabindex', '0');
});

it('renders code and safe links without executing HTML or loading embedded images', () => {
  const { container } = render(
    <ChatMarkdown
      content={
        'Use `easy`.\n\n```text\n6 km easy\n```\n\n[Source](https://example.com/training)\n\n[Unsafe](javascript:alert%281%29)\n\n<img src="bad" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n![Training image](https://example.com/image.png)'
      }
    />,
  );
  expect(container.querySelector('pre code')).toHaveTextContent('6 km easy');
  expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
    'href',
    'https://example.com/training',
  );
  expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  expect(screen.queryByRole('link', { name: 'Unsafe' })).not.toBeInTheDocument();
  expect(container.querySelector('script, img')).toBeNull();
  expect(screen.getByText('Training image')).toBeInTheDocument();
});
