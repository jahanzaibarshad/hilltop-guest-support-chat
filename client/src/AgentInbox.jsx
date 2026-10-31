import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { mergeMessages, useRealtime } from './realtime.js';
import './agent-inbox.css';
import HistorySearch from './HistorySearch.jsx';

const isAssigned = (chat, user) => String(chat?.assignedAgent) === user.id;
const unread = (chat) =>
  Boolean(
    chat?.lastGuestMessage && String(chat.lastGuestMessage) !== String(chat.agentReadMessage),
  );
const connectionLabel = (state) =>
  ({
    live: 'Live inbox connected',
    syncing: 'Recovering conversation…',
    connecting: 'Connecting to live inbox…',
  })[state] || 'Reconnecting · REST replies available';
function preserveChat(previous, next) {
  if (!previous || previous._id !== next._id) return next;
  return {
    ...previous,
    ...next,
    guest:
      typeof next.guest === 'string' && previous.guest?._id === next.guest
        ? previous.guest
        : next.guest,
    status: previous.status === 'closed' ? 'closed' : next.status,
  };
}

export default function AgentInbox({ user, onSessionExpired }) {
  const [filter, setFilter] = useState('waiting'),
    [page, setPage] = useState(1);
  const [inbox, setInbox] = useState(null),
    [listLoading, setListLoading] = useState(true),
    [listError, setListError] = useState('');
  const [selected, setSelected] = useState(null),
    [messages, setMessages] = useState([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [draft, setDraft] = useState(''),
    [hasOlder, setHasOlder] = useState(false),
    [olderBusy, setOlderBusy] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const [pane, setPane] = useState('list'),
    [following, setFollowing] = useState(true),
    [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const [compact, setCompact] = useState(
    () => window.matchMedia?.('(max-width: 800px)').matches ?? false,
  );
  const activeId = useRef(null),
    snapshot = useRef([]),
    drafts = useRef(new Map()),
    attempts = useRef(new Map()),
    version = useRef(0),
    listVersion = useRef(0),
    mounted = useRef(true);
  const historyReady = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyChanges, setHistoryChanges] = useState(0);
  const scroll = useRef(null),
    prepend = useRef(null),
    debounce = useRef(null),
    listRequest = useRef({ filter, page }),
    reading = useRef(new Set()),
    detailHeading = useRef(null);
  const detailVisible = Boolean(selected && (!compact || pane === 'chat'));
  function merge(batch) {
    const known = new Set(snapshot.current.map((message) => message._id));
    const changed = batch.some((message) => !known.has(message._id));
    const next = mergeMessages(snapshot.current, batch);
    snapshot.current = next;
    setMessages(next);
    if (changed) setHistoryChanges((previous) => previous + 1);
  }
  function updateChat(chat) {
    if (activeId.current === chat._id) setSelected((previous) => preserveChat(previous, chat));
  }
  async function refreshInbox(showLoading = false) {
    const request = ++listVersion.current;
    if (showLoading) setListLoading(true);
    const current = listRequest.current;
    try {
      const data = await api(`/agent/chats?status=${current.filter}&page=${current.page}`);
      if (!mounted.current || request !== listVersion.current) return;
      if (data.pagination.page > data.pagination.pages) {
        setPage(data.pagination.pages);
        return;
      }
      setInbox(data);
      setListError('');
    } catch (failure) {
      if (mounted.current && request === listVersion.current) {
        if (failure.status === 401) onSessionExpired();
        else setListError(failure.message);
      }
    } finally {
      if (mounted.current && request === listVersion.current) setListLoading(false);
    }
  }
  function scheduleRefresh() {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (mounted.current) void refreshInbox();
    }, 180);
  }
  async function recover(chatId, anchor = snapshot.current.at(-1)?._id) {
    const generation = version.current;
    const chat = await api(`/chats/${chatId}`);
    if (!mounted.current || activeId.current !== chatId || generation !== version.current) return;
    updateChat(chat);
    let cursor = anchor;
    for (let count = 0; count < 200; count++) {
      const data = await api(`/chats/${chatId}/messages/sync${cursor ? `?after=${cursor}` : ''}`);
      if (!mounted.current || activeId.current !== chatId || generation !== version.current) return;
      merge(data.messages);
      if (!data.hasMore) return;
      cursor = data.nextCursor;
    }
    throw new Error('Large message backlog. Refresh the conversation to load the latest messages.');
  }
  const realtime = useRealtime({
    userId: user.id,
    chatId: detailVisible && isAssigned(selected, user) ? selected._id : null,
    onMessage: (message) => {
      if (activeId.current === message.chat) {
        merge([message]);
        if (message.senderRole === 'guest')
          setSelected((previous) => ({
            ...previous,
            lastGuestMessage: message._id,
            lastMessageAt: message.createdAt,
          }));
      }
      scheduleRefresh();
    },
    onSync: (chatId) => (historyReady.current ? recover(chatId) : Promise.resolve()),
    onChat: updateChat,
    onError: setError,
    onSessionExpired,
    onInbox: scheduleRefresh,
    onConnected: scheduleRefresh,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++version.current;
      ++listVersion.current;
      clearTimeout(debounce.current);
    };
  }, []);
  useEffect(() => {
    listRequest.current = { filter, page };
    setInbox(null);
    void refreshInbox(true);
  }, [filter, page]);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 800px)');
    const change = () => setCompact(query?.matches ?? false);
    query?.addEventListener('change', change);
    const visibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', visibility);
    return () => {
      query?.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useLayoutEffect(() => {
    if (detailVisible) detailHeading.current?.focus();
  }, [selected?._id, detailVisible]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (prepend.current) {
      node.scrollTop = prepend.current.top + (node.scrollHeight - prepend.current.height);
      prepend.current = null;
    } else if (following) node.scrollTop = node.scrollHeight;
  }, [messages, following, detailVisible]);
  useEffect(() => {
    if (
      !selected ||
      !isAssigned(selected, user) ||
      !detailVisible ||
      historyOpen ||
      !visible ||
      !following ||
      loading ||
      !unread(selected) ||
      !messages.length
    )
      return;
    const key = `${selected._id}:${selected.lastGuestMessage}`;
    if (reading.current.has(key)) return;
    const latest = messages.at(-1);
    reading.current.add(key);
    api(`/chats/${selected._id}/read`, { method: 'POST', body: { messageId: latest._id } })
      .then((chat) => {
        if (mounted.current && activeId.current === chat._id) {
          setSelected((previous) =>
            previous?._id === chat._id
              ? { ...previous, agentReadMessage: chat.agentReadMessage }
              : previous,
          );
          scheduleRefresh();
        }
      })
      .catch((failure) => {
        if (mounted.current) setError(failure.message);
      })
      .finally(() => {
        reading.current.delete(key);
      });
  }, [
    selected?.lastGuestMessage,
    selected?.agentReadMessage,
    messages.at(-1)?._id,
    detailVisible,
    visible,
    following,
    loading,
    historyOpen,
  ]);
  async function openChat(chat) {
    const generation = ++version.current;
    historyReady.current = false;
    setHistoryOpen(false);
    setHistoryChanges(0);
    activeId.current = chat._id;
    setSelected(chat);
    setPane('chat');
    setConfirmClose(false);
    setError('');
    setOlderBusy(false);
    setDraft(drafts.current.get(chat._id) || '');
    snapshot.current = [];
    setMessages([]);
    setHasOlder(false);
    setFollowing(true);
    prepend.current = null;
    if (!isAssigned(chat, user)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [latest, data] = await Promise.all([
        api(`/chats/${chat._id}`),
        api(`/chats/${chat._id}/messages`),
      ]);
      if (!mounted.current || generation !== version.current) return;
      updateChat(latest);
      merge(data.messages);
      historyReady.current = true;
      setHasOlder(data.pagination.total > data.messages.length);
      await recover(chat._id, data.messages[0]?._id ?? null);
    } catch (failure) {
      if (mounted.current && generation === version.current) setError(failure.message);
    } finally {
      if (mounted.current && generation === version.current) {
        setLoading(false);
      }
    }
  }
  async function claim() {
    if (busy || !selected) return;
    setBusy('claim');
    setError('');
    try {
      const chat = await api(`/chats/${selected._id}/assign`, { method: 'PATCH' });
      setFilter('active');
      setPage(1);
      await openChat(preserveChat(selected, chat));
      void refreshInbox();
    } catch (failure) {
      setError(
        failure.status === 409
          ? 'Another agent claimed this conversation, or it was closed. Refresh the queue and choose another chat.'
          : failure.message,
      );
      if (failure.status === 409) {
        ++version.current;
        activeId.current = null;
        setSelected(null);
        snapshot.current = [];
        setMessages([]);
        setPane('list');
      }
      void refreshInbox();
    } finally {
      setBusy('');
    }
  }
  async function send(event) {
    event.preventDefault();
    if (busy || !draft.trim() || !selected || selected.status === 'closed') return;
    const chatId = selected._id,
      text = draft.trim();
    let attempt = attempts.current.get(chatId);
    if (attempt?.body !== text) {
      attempt = { body: text, clientMessageId: crypto.randomUUID() };
      attempts.current.set(chatId, attempt);
    }
    setBusy('send');
    setError('');
    try {
      const payload = { body: text, clientMessageId: attempt.clientMessageId };
      const message =
        realtime.state === 'live'
          ? await realtime.sendMessage({ chatId, ...payload })
          : await api(`/chats/${chatId}/messages`, { method: 'POST', body: payload });
      drafts.current.delete(chatId);
      attempts.current.delete(chatId);
      if (mounted.current && activeId.current === chatId) {
        merge([message]);
        setDraft('');
        setFollowing(true);
      }
      scheduleRefresh();
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message);
        if (failure.status === 409 && activeId.current === chatId) void recover(chatId);
      }
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function closeChat() {
    if (busy || !selected) return;
    setBusy('close');
    setError('');
    try {
      const chat = await api(`/chats/${selected._id}/close`, { method: 'PATCH' });
      updateChat(chat);
      setConfirmClose(false);
      void refreshInbox();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }
  async function loadOlder() {
    if (olderBusy || !selected || !snapshot.current.length) return;
    const generation = version.current,
      chatId = selected._id,
      before = snapshot.current[0]._id;
    setOlderBusy(true);
    setError('');
    try {
      const data = await api(`/chats/${chatId}/messages/older?before=${before}`);
      if (!mounted.current || generation !== version.current) return;
      if (scroll.current)
        prepend.current = { height: scroll.current.scrollHeight, top: scroll.current.scrollTop };
      setFollowing(false);
      merge(data.messages);
      setHasOlder(data.hasMore);
    } catch (failure) {
      if (mounted.current && generation === version.current) setError(failure.message);
    } finally {
      if (mounted.current) setOlderBusy(false);
    }
  }
  function chooseFilter(status) {
    if (busy) return;
    setFilter(status);
    setPage(1);
    setPane('list');
    setListError('');
  }
  return (
    <div className="agent-workspace" data-view={pane}>
      <div className="inbox-toolbar">
        <div>
          <p className="agent-welcome">Hello, {user.name}. Let’s take care of our guests.</p>
          <p className="realtime-status" role="status">
            {connectionLabel(realtime.state)}
          </p>
        </div>
        <button
          className="secondary"
          disabled={listLoading}
          onClick={() => void refreshInbox(true)}
        >
          Refresh inbox
        </button>
      </div>
      <nav className="inbox-filters" aria-label="Inbox filters">
        {['waiting', 'active', 'closed'].map((status) => (
          <button
            key={status}
            className="inbox-filter"
            aria-pressed={filter === status}
            onClick={() => chooseFilter(status)}
            disabled={Boolean(busy)}
          >
            <span>
              {status === 'active'
                ? 'My active'
                : status === 'closed'
                  ? 'My closed'
                  : 'Waiting queue'}
            </span>
            <strong>{inbox?.summary[status] ?? '—'}</strong>
          </button>
        ))}
        <div className="unread-total">
          <strong>{inbox?.summary.unread ?? '—'}</strong>
          <span>assigned chats unread</span>
        </div>
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="inbox-layout">
        <aside className="inbox-list panel" aria-label="Conversations">
          <div className="inbox-list-heading">
            <h3>
              {filter === 'waiting'
                ? 'Waiting for a warm welcome'
                : filter === 'active'
                  ? 'Your active conversations'
                  : 'Your closed conversations'}
            </h3>
            <small>Only your assignments and the waiting queue are shown.</small>
          </div>
          {listError && (
            <div role="alert">
              <p className="error">{listError}</p>
              <button className="secondary" onClick={() => void refreshInbox(true)}>
                Retry inbox
              </button>
            </div>
          )}
          {listLoading ? (
            <p role="status">Loading conversations…</p>
          ) : !listError && inbox?.chats.length === 0 ? (
            <div className="inbox-empty">
              <h4>{filter === 'waiting' ? 'The queue is clear.' : 'No conversations here yet.'}</h4>
              <p>
                {filter === 'waiting'
                  ? 'New guest conversations will appear here automatically.'
                  : 'Choose another view or refresh your inbox.'}
              </p>
            </div>
          ) : (
            !listError && (
              <ul className="agent-chat-list">
                {inbox?.chats.map((chat) => (
                  <li key={chat._id}>
                    <button
                      className="agent-chat-choice"
                      aria-pressed={selected?._id === chat._id}
                      onClick={() => void openChat(chat)}
                      disabled={Boolean(busy)}
                    >
                      <span className="chat-choice-top">
                        <strong>{chat.subject}</strong>
                        {chat.unread && <span className="unread-badge">Unread</span>}
                      </span>
                      <span>
                        {chat.guest?.name || 'Guest'} · {chat.category}
                      </span>
                      <span className="chat-choice-bottom">
                        <small className={`chat-status ${chat.status}`}>{chat.status}</small>
                        <time dateTime={chat.updatedAt}>
                          {new Date(chat.updatedAt).toLocaleDateString()}
                        </time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
          {inbox && inbox.pagination.pages > 1 && (
            <nav className="inbox-pagination" aria-label="Conversation pages">
              <button
                className="secondary"
                disabled={page <= 1 || listLoading || Boolean(busy)}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {inbox.pagination.pages}
              </span>
              <button
                className="secondary"
                disabled={page >= inbox.pagination.pages || listLoading || Boolean(busy)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </aside>
        <section className="agent-conversation panel" aria-label="Selected conversation">
          {!selected ? (
            <div className="empty">
              <span aria-hidden="true">↗</span>
              <h3>A thoughtful reply starts here.</h3>
              <p>Select a conversation. Claim a waiting chat to read its history and reply.</p>
            </div>
          ) : (
            <>
              <button
                className="secondary mobile-inbox-back"
                onClick={() => {
                  setPane('list');
                  requestAnimationFrame(() =>
                    document.querySelector('.agent-chat-choice[aria-pressed="true"]')?.focus(),
                  );
                }}
                disabled={Boolean(busy)}
              >
                ← Back to inbox
              </button>
              <div className="conversation-header">
                <div>
                  <p className="eyebrow">
                    {selected.category} · {selected.status}
                  </p>
                  <h3 ref={detailHeading} tabIndex={-1}>
                    {selected.subject}
                  </h3>
                  <small>
                    Guest: {selected.guest?.name || 'Guest'}
                    {isAssigned(selected, user) ? ' · Assigned to you' : ' · Not assigned'}
                  </small>
                </div>
                {isAssigned(selected, user) && (
                  <button
                    className="secondary"
                    disabled={loading || Boolean(busy)}
                    onClick={() => void openChat(selected)}
                  >
                    Refresh chat
                  </button>
                )}
              </div>
              {!isAssigned(selected, user) ? (
                <div className="claim-panel">
                  <h3>Give this guest a personal welcome.</h3>
                  <p>Message history stays private until you claim the conversation.</p>
                  <button
                    onClick={() => void claim()}
                    disabled={Boolean(busy) || selected.status === 'closed'}
                  >
                    {busy === 'claim' ? 'Assigning…' : 'Assign to me'}
                  </button>
                </div>
              ) : (
                <>
                  {historyOpen ? (
                    <HistorySearch
                      key={selected._id}
                      chatId={selected._id}
                      changes={historyChanges}
                      onBack={() => {
                        setHistoryOpen(false);
                        setFollowing(true);
                        requestAnimationFrame(() => detailHeading.current?.focus());
                      }}
                    />
                  ) : (
                    <>
                      <button
                        className="secondary search-history-toggle"
                        disabled={loading || Boolean(busy)}
                        onClick={() => setHistoryOpen(true)}
                      >
                        Search history
                      </button>
                      {hasOlder && (
                        <button
                          className="secondary load-history"
                          onClick={() => void loadOlder()}
                          disabled={olderBusy || loading}
                        >
                          {olderBusy ? 'Loading earlier messages…' : 'Load earlier messages'}
                        </button>
                      )}
                      <div
                        ref={scroll}
                        className="messages agent-messages"
                        role="log"
                        aria-label="Conversation messages"
                        aria-live="polite"
                        tabIndex={0}
                        onScroll={(event) => {
                          const node = event.currentTarget;
                          setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
                        }}
                      >
                        {loading ? (
                          <p role="status">Loading conversation…</p>
                        ) : messages.length === 0 ? (
                          <p>No messages yet. Send a warm welcome.</p>
                        ) : (
                          messages.map((message) => (
                            <article
                              key={message._id}
                              className={`message ${message.senderRole === 'agent' ? 'outgoing' : 'incoming'}`}
                            >
                              <strong>
                                {message.senderRole === 'agent' ? 'Support team' : 'Guest'}
                              </strong>
                              <p>{message.body}</p>
                              <time dateTime={message.createdAt}>
                                {new Date(message.createdAt).toLocaleString()}
                              </time>
                            </article>
                          ))
                        )}
                      </div>
                      {!following && (
                        <button
                          className="secondary latest-messages"
                          onClick={() => setFollowing(true)}
                        >
                          Jump to latest messages
                        </button>
                      )}
                      {selected.status === 'closed' ? (
                        <div className="closed-notice">
                          <strong>Conversation closed</strong>
                          <p>Saved history remains available. New replies are disabled.</p>
                          {draft && <p className="unsent-draft">Unsent draft: {draft}</p>}
                        </div>
                      ) : (
                        <>
                          <form className="composer" onSubmit={send}>
                            <label htmlFor="agent-message">Reply to guest</label>
                            <textarea
                              id="agent-message"
                              value={draft}
                              onChange={(event) => {
                                setDraft(event.target.value);
                                drafts.current.set(selected._id, event.target.value);
                              }}
                              maxLength={2000}
                              rows={3}
                              required
                              disabled={loading || Boolean(busy)}
                            />
                            <div>
                              <small>
                                {draft.length}/2000 · Never ask for passwords or card details.
                              </small>
                              <button disabled={loading || Boolean(busy) || !draft.trim()}>
                                {busy === 'send' ? 'Sending…' : 'Send reply'}
                              </button>
                            </div>
                          </form>
                          {confirmClose ? (
                            <div
                              className="close-confirm"
                              role="group"
                              aria-label="Confirm conversation closure"
                            >
                              <p>
                                Close this conversation? Saved history stays available. Any unsent
                                draft will not be delivered.
                              </p>
                              <button disabled={Boolean(busy)} onClick={() => void closeChat()}>
                                {busy === 'close' ? 'Closing…' : 'Close conversation'}
                              </button>
                              <button
                                className="secondary"
                                disabled={Boolean(busy)}
                                onClick={() => setConfirmClose(false)}
                              >
                                Keep open
                              </button>
                            </div>
                          ) : (
                            <button
                              className="text-button close-chat"
                              disabled={Boolean(busy) || loading}
                              onClick={() => setConfirmClose(true)}
                            >
                              Close conversation
                            </button>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
