import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { mergeMessages, useRealtime } from './realtime.js';
import AgentInbox from './AgentInbox.jsx';
import './styles.css';

function App() {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [mode, setMode] = useState('register');
  const [chats, setChats] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const requestVersion = useRef(0);
  const messageAttempt = useRef(null);
  const selectedId = useRef(null);
  const messageSnapshot = useRef([]);
  useEffect(() => {
    document.title =
      user?.role === 'agent'
        ? 'Hilltop Guest House | Agent inbox'
        : 'Hilltop Guest House | Guest support';
  }, [user?.role]);
  function mergeIncoming(incoming) {
    const next = mergeMessages(messageSnapshot.current, incoming);
    messageSnapshot.current = next;
    setMessages(next);
  }
  function updateChat(chat) {
    if (selectedId.current === chat._id)
      setSelected((previous) =>
        previous?._id === chat._id && previous.status === 'closed'
          ? { ...chat, status: 'closed' }
          : chat,
      );
    setChats((previous) =>
      previous.map((item) =>
        item._id === chat._id
          ? { ...chat, status: item.status === 'closed' ? 'closed' : chat.status }
          : item,
      ),
    );
  }
  function receiveMessage(message) {
    if (selectedId.current !== message.chat) return;
    mergeIncoming([message]);
    setChats((previous) =>
      previous.map((chat) =>
        chat._id === message.chat ? { ...chat, lastMessageAt: message.createdAt } : chat,
      ),
    );
  }
  async function recoverMessages(chatId, anchor = messageSnapshot.current.at(-1)?._id) {
    const latestChat = await api(`/chats/${chatId}`);
    if (selectedId.current !== chatId) return;
    updateChat(latestChat);
    let cursor = anchor;
    for (let page = 0; page < 200; page++) {
      if (selectedId.current !== chatId) return;
      const data = await api(`/chats/${chatId}/messages/sync${cursor ? `?after=${cursor}` : ''}`);
      if (selectedId.current !== chatId) return;
      mergeIncoming(data.messages);
      if (!data.hasMore) return;
      cursor = data.nextCursor;
    }
    throw new Error(
      'This conversation has a large backlog. Use Refresh to load its latest messages.',
    );
  }
  const realtime = useRealtime({
    userId: user?.role === 'guest' ? user.id : undefined,
    chatId: selected?._id,
    onMessage: receiveMessage,
    onSync: recoverMessages,
    onChat: updateChat,
    onError: setError,
    onSessionExpired: () => {
      ++requestVersion.current;
      selectedId.current = null;
      messageSnapshot.current = [];
      messageAttempt.current = null;
      setUser(null);
      setSelected(null);
      setMessages([]);
      setChats([]);
      setBody('');
      setError('Your session ended. Sign in again to continue.');
    },
  });
  useEffect(() => {
    let active = true;
    api('/auth/me')
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch((failure) => {
        if (active && failure.status !== 401)
          setError('The support API is not available yet. Database setup may be required.');
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user || user.role !== 'guest') return;
    let active = true;
    api('/chats')
      .then((data) => {
        if (active) setChats(data.chats);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [user]);
  async function authenticate(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const credentials = { email: form.get('email'), password: form.get('password') };
      const data = await api(mode === 'register' ? '/users' : '/auth/login', {
        method: 'POST',
        body: mode === 'register' ? { ...credentials, name: form.get('name') } : credentials,
      });
      setUser(data.user);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function openChat(chat) {
    const version = ++requestVersion.current;
    if (selected?._id !== chat._id) {
      setBody('');
      messageAttempt.current = null;
    }
    setSelected(chat);
    selectedId.current = chat._id;
    messageSnapshot.current = [];
    setMessages([]);
    setLoadingChat(true);
    setError('');
    try {
      const [latestChat, data] = await Promise.all([
        api(`/chats/${chat._id}`),
        api(`/chats/${chat._id}/messages`),
      ]);
      if (version === requestVersion.current) {
        updateChat(latestChat);
        mergeIncoming(data.messages);
        await recoverMessages(chat._id, data.messages[0]?._id ?? null);
      }
    } catch (failure) {
      if (version === requestVersion.current) setError(failure.message);
    } finally {
      if (version === requestVersion.current) setLoadingChat(false);
    }
  }
  async function startChat(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const chat = await api('/chats', {
        method: 'POST',
        body: { subject: form.get('subject'), category: form.get('category') },
      });
      setChats((previous) => [chat, ...previous]);
      await openChat(chat);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function send(event) {
    event.preventDefault();
    if (busy || !body.trim() || !selected) return;
    const chatId = selected._id;
    const text = body.trim();
    if (messageAttempt.current?.body !== text || messageAttempt.current?.chatId !== chatId)
      messageAttempt.current = { body: text, chatId, clientMessageId: crypto.randomUUID() };
    const attempt = messageAttempt.current;
    setBusy(true);
    setError('');
    try {
      const message =
        realtime.state === 'live'
          ? await realtime.sendMessage({
              chatId,
              body: text,
              clientMessageId: attempt.clientMessageId,
            })
          : await api(`/chats/${chatId}/messages`, {
              method: 'POST',
              body: { body: text, clientMessageId: attempt.clientMessageId },
            });
      if (selectedId.current === chatId) mergeIncoming([message]);
      setBody('');
      messageAttempt.current = null;
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      ++requestVersion.current;
      selectedId.current = null;
      messageSnapshot.current = [];
      setUser(null);
      setSelected(null);
      setMessages([]);
      setChats([]);
      setBody('');
      messageAttempt.current = null;
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header>
        <a className="brand" href="/" aria-label="Hilltop Guest House home">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <path d="M3 30 17 9l8 13 5-7 8 15M11 30l6-9 6 9" />
          </svg>
          <span>
            Hilltop<small>GUEST HOUSE</small>
          </span>
        </a>
        <span className="header-label">A little help. A warmer stay.</span>
        {user && (
          <button className="secondary" disabled={busy} onClick={signOut}>
            Sign out
          </button>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        {user?.role !== 'agent' && (
          <section className="intro">
            <div>
              <p className="eyebrow">YOUR STAY, TAKEN CARE OF</p>
              <h1>
                Make yourself
                <br />
                at home.
              </h1>
              <p>
                Booking questions, little requests, or something you need during your stay. Start a
                conversation with Hilltop guest support.
              </p>
              <div className="topics">
                <span>01 Booking help</span>
                <span>02 Amenities</span>
                <span>03 Your stay</span>
              </div>
            </div>
            <aside className="welcome-note">
              <span aria-hidden="true">✦</span>
              <p>
                Thoughtful hospitality
                <br />
                starts with listening.
              </p>
              <small>GUEST SUPPORT · HILLTOP</small>
            </aside>
          </section>
        )}
        <section
          className={`support-section${user?.role === 'agent' ? ' agent-section' : ''}`}
          aria-labelledby="support-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {user?.role === 'agent' ? 'SUPPORT WORKSPACE' : 'LET’S TALK'}
              </p>
              <h2 id="support-title">
                {user?.role === 'agent' ? 'Agent inbox' : 'How can we help?'}
              </h2>
            </div>
            {user?.role !== 'agent' && (
              <p className="stage-note realtime-status" role="status">
                {!user
                  ? 'Private guest support'
                  : realtime.state === 'live'
                    ? 'Live chat connected'
                    : realtime.state === 'syncing'
                      ? 'Recovering messages…'
                      : realtime.state === 'connecting'
                        ? 'Connecting to live chat…'
                        : 'Reconnecting · REST messaging available'}
              </p>
            )}
          </div>
          <p className="safety-note">
            For immediate danger or a medical emergency, contact emergency services or the front
            desk directly. Chat is not an emergency response service.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {restoring ? (
            <p role="status">Checking your session…</p>
          ) : !user ? (
            <div className="account-layout">
              <div>
                <h3>A conversation that stays yours.</h3>
                <p>
                  Sign in or create a guest account to keep your questions and replies together.
                </p>
                <ul>
                  <li>Your conversation is private to you and your assigned agent.</li>
                  <li>You can return to your saved messages.</li>
                  <li>Only share information needed to help with your stay.</li>
                </ul>
              </div>
              <form onSubmit={authenticate} className="panel">
                <h3>{mode === 'register' ? 'Create your guest account' : 'Welcome back'}</h3>
                {mode === 'register' && (
                  <label>
                    Full name
                    <input name="name" autoComplete="name" minLength={2} maxLength={80} required />
                  </label>
                )}
                <label>
                  Email address
                  <input name="email" type="email" autoComplete="email" maxLength={254} required />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    minLength={mode === 'register' ? 10 : 1}
                    maxLength={72}
                    required
                  />
                </label>
                {mode === 'register' && (
                  <small>Use 10–72 characters; maximum 72 UTF-8 bytes.</small>
                )}
                <button disabled={busy}>
                  {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode(mode === 'register' ? 'login' : 'register');
                    setError('');
                  }}
                >
                  {mode === 'register'
                    ? 'Already have an account? Sign in'
                    : 'New here? Create an account'}
                </button>
              </form>
            </div>
          ) : user.role === 'agent' ? (
            <AgentInbox
              user={user}
              onSessionExpired={() => {
                setUser(null);
                setSelected(null);
                setChats([]);
                setMessages([]);
                selectedId.current = null;
                messageSnapshot.current = [];
                setError('Your session ended. Sign in again to continue.');
              }}
            />
          ) : (
            <div className="chat-layout">
              <aside className="panel">
                <h3>Hello, {user.name}.</h3>
                <form onSubmit={startChat}>
                  <label>
                    What’s on your mind?
                    <input
                      name="subject"
                      placeholder="e.g. A question about check-in"
                      minLength={3}
                      maxLength={120}
                      required
                    />
                  </label>
                  <label>
                    Topic
                    <select name="category">
                      <option value="general">Your stay</option>
                      <option value="booking">Booking question</option>
                      <option value="amenities">Amenities</option>
                      <option value="urgent">Urgent concern (not emergency dispatch)</option>
                    </select>
                  </label>
                  <button disabled={busy}>Start a conversation</button>
                </form>
                <h3 className="conversation-title">Your conversations</h3>
                {!chats.length && <p>No conversations yet.</p>}
                <ul className="chat-list">
                  {chats.map((chat) => (
                    <li key={chat._id}>
                      <button
                        className="chat-choice"
                        aria-pressed={selected?._id === chat._id}
                        disabled={busy}
                        onClick={() => openChat(chat)}
                      >
                        {chat.subject}
                        <small>{chat.status}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>
              <div className="panel conversation">
                {!selected ? (
                  <div className="empty">
                    <span aria-hidden="true">↗</span>
                    <h3>A little help is just a message away.</h3>
                    <p>Start a conversation or open one from your list.</p>
                  </div>
                ) : (
                  <>
                    <div className="conversation-header">
                      <div>
                        <h3>{selected.subject}</h3>
                        <small>{selected.status} · Live messages with saved history</small>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy || loadingChat}
                        onClick={() => openChat(selected)}
                      >
                        Refresh
                      </button>
                    </div>
                    <div
                      className="messages"
                      role="log"
                      aria-label="Conversation messages"
                      aria-live="polite"
                    >
                      {loadingChat ? (
                        <p role="status">Loading messages…</p>
                      ) : !messages.length ? (
                        <p>Tell us a little about what you need.</p>
                      ) : (
                        messages.map((message) => (
                          <article key={message._id} className={`message ${message.senderRole}`}>
                            <strong>
                              {message.senderRole === 'guest' ? 'You' : 'Guest support'}
                            </strong>
                            <p>{message.body}</p>
                            <time dateTime={message.createdAt}>
                              {new Date(message.createdAt).toLocaleString()}
                            </time>
                          </article>
                        ))
                      )}
                    </div>
                    {selected.status === 'closed' ? (
                      <p>This conversation is closed. You can start another if you need help.</p>
                    ) : (
                      <form className="composer" onSubmit={send}>
                        <label htmlFor="message">Your message</label>
                        <textarea
                          id="message"
                          value={body}
                          onChange={(event) => setBody(event.target.value)}
                          maxLength={2000}
                          rows={3}
                          disabled={busy || loadingChat}
                          required
                        />
                        <div>
                          <small>{body.length}/2000 · Don’t share passwords or card details.</small>
                          <button disabled={busy || loadingChat || !body.trim()}>
                            {busy ? 'Sending…' : 'Send message'}
                          </button>
                        </div>
                      </form>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
      <footer>
        <span>Hilltop Guest House</span>
        <span>Guest support, with a personal touch.</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
