import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentInbox from '../AgentInbox.jsx';
import { api } from '../api.js';
import { useRealtime } from '../realtime.js';
vi.mock('../api.js', () => ({ api: vi.fn() }));
vi.mock('../realtime.js', async (original) => {
  const actual = await original();
  return { ...actual, useRealtime: vi.fn() };
});
const user = { id: 'agent', name: 'Support Person', role: 'agent' };
const waiting = {
  _id: 'waiting',
  subject: 'Early check-in',
  category: 'booking',
  guest: { _id: 'guest', name: 'Guest One' },
  assignedAgent: null,
  status: 'waiting',
  lastGuestMessage: null,
  agentReadMessage: null,
  updatedAt: '2026-10-27T08:00:00Z',
};
const active = {
  ...waiting,
  _id: 'active',
  subject: 'Extra towels',
  assignedAgent: user.id,
  status: 'active',
};
const other = { ...active, _id: 'second', subject: 'Breakfast time' };
const message = {
  _id: 'message',
  chat: 'active',
  body: 'Could we have extra towels?',
  senderRole: 'guest',
  createdAt: '2026-10-27T08:01:00Z',
};
let callbacks, sendMessage, chats, history;
function list(status) {
  const rows = chats.filter((c) => c.status === status);
  return {
    chats: rows.map((c) => ({
      ...c,
      unread: Boolean(c.lastGuestMessage && c.lastGuestMessage !== c.agentReadMessage),
    })),
    summary: {
      waiting: chats.filter((c) => c.status === 'waiting').length,
      active: chats.filter((c) => c.status === 'active').length,
      closed: chats.filter((c) => c.status === 'closed').length,
      unread: 0,
    },
    pagination: { page: 1, limit: 20, total: rows.length, pages: 1 },
  };
}
function preview() {
  return render(<AgentInbox user={user} onSessionExpired={vi.fn()} />);
}
beforeEach(() => {
  chats = [{ ...waiting }, { ...active }, { ...other }];
  history = { active: [message], second: [] };
  sendMessage = vi.fn(async (payload) => ({
    ...message,
    _id: 'reply',
    senderRole: 'agent',
    chat: payload.chatId,
    body: payload.body,
  }));
  useRealtime.mockImplementation((value) => {
    callbacks = value;
    return { state: 'live', sendMessage };
  });
  api.mockReset();
  api.mockImplementation(async (path, options = {}) => {
    if (path.startsWith('/agent/chats'))
      return list(new URLSearchParams(path.split('?')[1]).get('status'));
    const id = path.split('/')[2];
    const chat = chats.find((c) => c._id === id);
    if (path.endsWith('/assign')) {
      const next = { ...chat, status: 'active', assignedAgent: user.id };
      chats = chats.map((c) => (c._id === id ? next : c));
      history[id] = [];
      return next;
    }
    if (path.endsWith('/close')) {
      const next = { ...chat, status: 'closed' };
      chats = chats.map((c) => (c._id === id ? next : c));
      return next;
    }
    if (path.endsWith('/read')) {
      const next = { ...chat, agentReadMessage: chat.lastGuestMessage };
      chats = chats.map((c) => (c._id === id ? next : c));
      return next;
    }
    if (path.includes('/messages/sync')) return { messages: [], hasMore: false, nextCursor: null };
    if (path.includes('/messages/older'))
      return {
        messages: [
          {
            ...message,
            _id: 'earlier',
            body: 'Earlier saved message',
            createdAt: '2026-10-26T08:00:00Z',
          },
        ],
        hasMore: false,
      };
    if (path.endsWith('/messages'))
      return {
        messages: (history[id] || []).slice().reverse(),
        pagination: { page: 1, total: history[id]?.length || 0, pages: 1, limit: 20 },
      };
    if (options.method === 'POST') throw new Error('Unexpected write');
    return chat;
  });
});
describe('Agent inbox', () => {
  it('keeps search results read-only and signals messages recovered while searching', async () => {
    let recovered = false;
    const normal = api.getMockImplementation();
    api.mockImplementation(async (path, options) => {
      if (path.includes('/messages?'))
        return {
          messages: [message],
          pagination: { page: 1, limit: 20, total: 1, pages: 1, snapshot: 'snapshot' },
        };
      if (recovered && path.includes('/messages/sync'))
        return {
          messages: [{ ...message, _id: 'recovered-message', body: 'Recovered unseen message' }],
          hasMore: false,
        };
      return normal(path, options);
    });
    preview();
    const click = userEvent.setup();
    await click.click(screen.getByRole('button', { name: /My active/ }));
    await click.click(await screen.findByRole('button', { name: /Extra towels/ }));
    await screen.findByText(message.body);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Reply to guest' })).toBeEnabled(),
    );
    await click.type(screen.getByRole('textbox', { name: 'Reply to guest' }), 'Keep my draft');
    await click.click(screen.getByRole('button', { name: 'Search history' }));
    await screen.findByRole('searchbox');
    await screen.findByText(message.body);
    expect(screen.queryByRole('textbox', { name: 'Reply to guest' })).not.toBeInTheDocument();
    recovered = true;
    await act(async () => callbacks.onSync('active'));
    await screen.findByText(/Conversation updated/);
    expect(screen.queryByText('Recovered unseen message')).not.toBeInTheDocument();
    await click.click(screen.getByRole('button', { name: 'Return to live chat' }));
    expect(screen.getByRole('textbox', { name: 'Reply to guest' })).toHaveValue('Keep my draft');
    expect(screen.getByText('Recovered unseen message')).toBeInTheDocument();
  });
  it('shows scoped queue without requesting private history before assignment', async () => {
    preview();
    const click = userEvent.setup();
    await click.click(await screen.findByRole('button', { name: /Early check-in/ }));
    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeInTheDocument();
    expect(
      screen.getByText('Message history stays private until you claim the conversation.'),
    ).toBeInTheDocument();
    expect(api.mock.calls.some(([path]) => path.includes('/messages'))).toBe(false);
  });
  it('claims a chat and opens the assigned conversation', async () => {
    preview();
    const click = userEvent.setup();
    await click.click(await screen.findByRole('button', { name: /Early check-in/ }));
    await click.click(screen.getByRole('button', { name: 'Assign to me' }));
    await screen.findByRole('textbox', { name: 'Reply to guest' });
    expect(api).toHaveBeenCalledWith('/chats/waiting/assign', { method: 'PATCH' });
    expect(screen.getByRole('button', { name: /My active/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('shows assignment conflicts without revealing history', async () => {
    const normal = api.getMockImplementation();
    api.mockImplementation(async (path, options) => {
      if (path.endsWith('/assign')) throw Object.assign(new Error('Conflict'), { status: 409 });
      return normal(path, options);
    });
    preview();
    const click = userEvent.setup();
    await click.click(await screen.findByRole('button', { name: /Early check-in/ }));
    await click.click(screen.getByRole('button', { name: 'Assign to me' }));
    await screen.findByText(/Another agent claimed/);
    expect(screen.queryByRole('textbox', { name: 'Reply to guest' })).not.toBeInTheDocument();
  });
  it('opens assigned history and sends an authenticated live reply', async () => {
    preview();
    const click = userEvent.setup();
    await click.click(screen.getByRole('button', { name: /My active/ }));
    await click.click(await screen.findByRole('button', { name: /Extra towels/ }));
    await screen.findByText(message.body);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Reply to guest' })).toBeEnabled(),
    );
    await click.type(screen.getByRole('textbox', { name: 'Reply to guest' }), 'On our way.');
    await click.click(screen.getByRole('button', { name: 'Send reply' }));
    await screen.findByText('On our way.');
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'active',
        body: 'On our way.',
        clientMessageId: expect.any(String),
      }),
    );
  });
  it('keeps reply focus when delayed animation frames run after history loads', async () => {
    const frames = [];
    const animation = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    try {
      preview();
      const keyboard = userEvent.setup();
      await keyboard.click(screen.getByRole('button', { name: /My active/ }));
      await keyboard.click(await screen.findByRole('button', { name: /Extra towels/ }));
      const textbox = await screen.findByRole('textbox', { name: 'Reply to guest' });
      await waitFor(() => expect(textbox).toBeEnabled());
      await keyboard.click(textbox);
      await act(async () => {
        for (const callback of frames.splice(0)) callback(performance.now());
      });
      expect(textbox).toHaveFocus();
      await keyboard.type(textbox, 'A complete keyboard reply', { skipClick: true });
      expect(textbox).toHaveValue('A complete keyboard reply');
    } finally {
      animation.mockRestore();
    }
  });
  it('keeps separate drafts while switching chats', async () => {
    preview();
    const click = userEvent.setup();
    await click.click(screen.getByRole('button', { name: /My active/ }));
    await click.click(await screen.findByRole('button', { name: /Extra towels/ }));
    const textbox = await screen.findByRole('textbox', { name: 'Reply to guest' });
    await waitFor(() => expect(textbox).toBeEnabled());
    await click.type(textbox, 'Towels draft');
    await click.click(screen.getByRole('button', { name: /Breakfast time/ }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Reply to guest' })).toBeEnabled(),
    );
    await click.type(screen.getByRole('textbox', { name: 'Reply to guest' }), 'Breakfast draft');
    await click.click(screen.getByRole('button', { name: /Extra towels/ }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Reply to guest' })).toHaveValue('Towels draft'),
    );
  });
  it('requires confirmation before closing and keeps saved history', async () => {
    preview();
    const click = userEvent.setup();
    await click.click(screen.getByRole('button', { name: /My active/ }));
    await click.click(await screen.findByRole('button', { name: /Extra towels/ }));
    await screen.findByText(message.body);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close conversation' })).toBeEnabled(),
    );
    await click.click(screen.getByRole('button', { name: 'Close conversation' }));
    expect(api.mock.calls.some(([path]) => path.endsWith('/close'))).toBe(false);
    await click.click(
      within(screen.getByRole('group', { name: 'Confirm conversation closure' })).getByRole(
        'button',
        { name: 'Close conversation' },
      ),
    );
    await screen.findByText('Conversation closed');
    expect(screen.queryByRole('textbox', { name: 'Reply to guest' })).not.toBeInTheDocument();
    expect(screen.getByText(message.body)).toBeInTheDocument();
  });
  it('loads earlier messages without duplicating the current history', async () => {
    const normal = api.getMockImplementation();
    api.mockImplementation(async (path, options) => {
      const response = await normal(path, options);
      if (path === '/chats/active/messages') response.pagination.total = 25;
      return response;
    });
    preview();
    const click = userEvent.setup();
    await click.click(screen.getByRole('button', { name: /My active/ }));
    await click.click(await screen.findByRole('button', { name: /Extra towels/ }));
    await screen.findByText(message.body);
    await click.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    await screen.findByText('Earlier saved message');
    expect(screen.getAllByText(message.body)).toHaveLength(1);
  });
  it('recovers from an inbox fetch failure', async () => {
    api.mockRejectedValueOnce(new Error('Connection lost'));
    preview();
    await screen.findByText('Connection lost');
    await userEvent.click(screen.getByRole('button', { name: 'Retry inbox' }));
    await screen.findByRole('button', { name: /Early check-in/ });
  });
  it('handles live selected-chat messages and queue invalidations', async () => {
    preview();
    const click = userEvent.setup();
    await click.click(screen.getByRole('button', { name: /My active/ }));
    await click.click(await screen.findByRole('button', { name: /Extra towels/ }));
    await screen.findByText(message.body);
    await act(async () =>
      callbacks.onMessage({ ...message, _id: 'new-message', body: 'A live guest message' }),
    );
    await screen.findByText('A live guest message');
    chats.push({ ...waiting, _id: 'new-chat', subject: 'Late arrival' });
    await act(async () => callbacks.onInbox());
    await click.click(screen.getByRole('button', { name: /Waiting queue/ }));
    await screen.findByRole('button', { name: /Late arrival/ });
  });
});
