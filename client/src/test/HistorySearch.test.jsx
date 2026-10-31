import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistorySearch from '../HistorySearch.jsx';
import { api } from '../api.js';
vi.mock('../api.js', () => ({ api: vi.fn() }));
const message = {
  _id: 'message',
  body: 'Saved breakfast message',
  senderRole: 'guest',
  createdAt: '2026-10-27T12:00:00Z',
};
const response = (overrides = {}) => ({
  messages: [message],
  pagination: {
    page: 1,
    limit: 20,
    total: 45,
    pages: 3,
    snapshot: 'frozen-snapshot',
    ...overrides,
  },
});
beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path) => {
    const params = new URLSearchParams(path.split('?')[1]);
    return response({ page: Number(params.get('page')) });
  });
});
describe('History filtering and pagination', () => {
  it('loads at most 20 results per page and displays UTC date semantics', async () => {
    render(<HistorySearch chatId="chat" onBack={vi.fn()} />);
    await screen.findByText(message.body);
    expect(api).toHaveBeenCalledWith('/chats/chat/messages?page=1&limit=20');
    expect(screen.getByText(/Dates use UTC/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous messages' })).toBeDisabled();
  });
  it('applies text and both dates while resetting the page and snapshot', async () => {
    render(<HistorySearch chatId="chat" onBack={vi.fn()} />);
    await screen.findByText(message.body);
    const click = userEvent.setup();
    await click.click(screen.getByRole('button', { name: 'Next messages' }));
    await screen.findByText('Page 2 of 3');
    await click.type(screen.getByRole('searchbox', { name: 'Search messages' }), 'breakfast');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-10-27' } });
    await click.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(api).toHaveBeenLastCalledWith(
        '/chats/chat/messages?page=1&limit=20&search=breakfast&start=2026-10-01&end=2026-10-27',
      ),
    );
  });
  it('next/previous preserve the same snapshot and filters', async () => {
    render(<HistorySearch chatId="chat" onBack={vi.fn()} />);
    await screen.findByText(message.body);
    const click = userEvent.setup();
    await click.click(screen.getByRole('button', { name: 'Next messages' }));
    await screen.findByText('Page 2 of 3');
    expect(api).toHaveBeenLastCalledWith(
      '/chats/chat/messages?page=2&limit=20&snapshot=frozen-snapshot',
    );
    await click.click(screen.getByRole('button', { name: 'Previous messages' }));
    await screen.findByText('Page 1 of 3');
    expect(api).toHaveBeenLastCalledWith(
      '/chats/chat/messages?page=1&limit=20&snapshot=frozen-snapshot',
    );
  });
  it('clear resets all applied filters', async () => {
    render(<HistorySearch chatId="chat" onBack={vi.fn()} />);
    await screen.findByText(message.body);
    const click = userEvent.setup();
    await click.type(screen.getByRole('searchbox'), 'breakfast');
    await click.click(screen.getByRole('button', { name: 'Apply filters' }));
    await screen.findByText(/Keyword: breakfast/);
    await click.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(api).toHaveBeenLastCalledWith('/chats/chat/messages?page=1&limit=20'),
    );
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
  it('does not send a reversed date range', async () => {
    render(<HistorySearch chatId="chat" onBack={vi.fn()} />);
    await screen.findByText(message.body);
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-28' } });
    fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-10-27' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Start date must not be after end date.');
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('empty results have clear guidance and disabled boundaries', async () => {
    api.mockResolvedValue({
      messages: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 1, snapshot: 'empty' },
    });
    render(<HistorySearch chatId="chat" onBack={vi.fn()} />);
    await screen.findByText('No matching messages');
    expect(screen.getByRole('button', { name: 'Next messages' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous messages' })).toBeDisabled();
  });
  it('shows a retry action after failure', async () => {
    api.mockRejectedValueOnce(new Error('Temporary failure'));
    render(<HistorySearch chatId="chat" onBack={vi.fn()} />);
    await screen.findByText('Temporary failure');
    await userEvent.click(screen.getByRole('button', { name: 'Retry history search' }));
    await screen.findByText(message.body);
  });
  it('new live messages flag a refresh without silently changing the current page', async () => {
    const view = render(<HistorySearch chatId="chat" changes={0} onBack={vi.fn()} />);
    await screen.findByText(message.body);
    await userEvent.click(screen.getByRole('button', { name: 'Next messages' }));
    await screen.findByText('Page 2 of 3');
    const calls = api.mock.calls.length;
    view.rerender(<HistorySearch chatId="chat" changes={1} onBack={vi.fn()} />);
    expect(api).toHaveBeenCalledTimes(calls);
    expect(screen.getByText(/Conversation updated/)).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByText(/Conversation updated/).parentElement).getByRole('button', {
        name: 'Refresh results',
      }),
    );
    await screen.findByText('Page 1 of 3');
    expect(api).toHaveBeenLastCalledWith('/chats/chat/messages?page=1&limit=20');
  });
  it('ignores a late response from an earlier search', async () => {
    let resolveOld;
    api.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    render(<HistorySearch chatId="chat" onBack={vi.fn()} />);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await userEvent.type(screen.getByRole('searchbox'), 'new filter');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await screen.findByText(message.body);
    await act(async () =>
      resolveOld({
        messages: [{ ...message, body: 'Stale old result' }],
        pagination: response().pagination,
      }),
    );
    expect(screen.queryByText('Stale old result')).not.toBeInTheDocument();
  });
  it('can return to live chat without changing the draft owner', async () => {
    const onBack = vi.fn();
    render(<HistorySearch chatId="chat" onBack={onBack} />);
    await userEvent.click(screen.getByRole('button', { name: 'Return to live chat' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
