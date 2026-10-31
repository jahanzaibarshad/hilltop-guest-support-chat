import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import './history-search.css';

const empty = { search: '', start: '', end: '' };
export default function HistorySearch({ chatId, changes = 0, onBack }) {
  const [form, setForm] = useState(empty),
    [query, setQuery] = useState({ ...empty, page: 1, nonce: 0 });
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [baseline, setBaseline] = useState(changes);
  const changesRef = useRef(changes),
    heading = useRef(null);
  useEffect(() => {
    changesRef.current = changes;
  }, [changes]);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    let active = true;
    const requestBaseline = changesRef.current;
    setLoading(true);
    setError('');
    setData(null);
    const params = new URLSearchParams({ page: String(query.page), limit: '20' });
    for (const field of ['search', 'start', 'end', 'snapshot'])
      if (query[field]) params.set(field, query[field]);
    api(`/chats/${chatId}/messages?${params}`)
      .then((result) => {
        if (!active) return;
        if (result.pagination.page > result.pagination.pages) {
          setQuery((previous) => ({
            ...previous,
            page: result.pagination.pages,
            snapshot: result.pagination.snapshot,
          }));
          return;
        }
        setData(result);
        if (!query.snapshot) setBaseline(requestBaseline);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chatId, query]);
  function apply(event) {
    event.preventDefault();
    if (form.start && form.end && form.start > form.end) {
      setError('Start date must not be after end date.');
      return;
    }
    setQuery((previous) => ({
      ...form,
      search: form.search.trim(),
      page: 1,
      nonce: previous.nonce + 1,
    }));
  }
  function refresh() {
    setQuery((previous) => ({
      ...previous,
      page: 1,
      snapshot: undefined,
      nonce: previous.nonce + 1,
    }));
  }
  function clear() {
    setForm(empty);
    setQuery((previous) => ({ ...empty, page: 1, nonce: previous.nonce + 1 }));
  }
  const pagination = data?.pagination;
  return (
    <section className="history-search" aria-labelledby="history-heading">
      <div className="history-heading">
        <h4 id="history-heading" ref={heading} tabIndex={-1}>
          Search saved messages
        </h4>
        <button className="secondary" onClick={onBack}>
          Return to live chat
        </button>
      </div>
      <p id="history-help">
        Literal text search · Dates use UTC · Through date includes the whole day.
      </p>
      <form className="history-filter-form" onSubmit={apply} aria-describedby="history-help">
        <label className="keyword-filter">
          Search messages
          <input
            type="search"
            value={form.search}
            maxLength={80}
            placeholder="e.g. check-in or breakfast"
            onChange={(event) =>
              setForm((previous) => ({ ...previous, search: event.target.value }))
            }
          />
        </label>
        <label>
          From date
          <input
            type="date"
            value={form.start}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, start: event.target.value }))
            }
          />
        </label>
        <label>
          Through date
          <input
            type="date"
            value={form.end}
            onChange={(event) => setForm((previous) => ({ ...previous, end: event.target.value }))}
          />
        </label>
        <div className="history-filter-actions">
          <button type="submit">Apply filters</button>
          <button type="button" className="secondary" onClick={clear}>
            Clear filters
          </button>
        </div>
      </form>
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <button className="secondary" onClick={refresh}>
            Retry history search
          </button>
        </div>
      )}
      {changes !== baseline && (
        <div className="history-update-notice" role="status">
          <p>
            Conversation updated. Refresh results to include any new matches; your current pages
            stay unchanged.
          </p>
          <button className="secondary" onClick={refresh}>
            Refresh results
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">Searching saved messages…</p>
      ) : (
        data && (
          <>
            <div className="history-result-summary">
              <p role="status">
                {pagination.total} matching message{pagination.total === 1 ? '' : 's'} · Newest
                first
              </p>
              {changes === baseline && (
                <button className="text-button" onClick={refresh}>
                  Refresh results
                </button>
              )}
            </div>
            <p className="history-applied" aria-label="Applied history filters">
              Keyword: {query.search || 'all messages'} · Dates: {query.start || 'any start'} to{' '}
              {query.end || 'any end'} (UTC)
            </p>
            {data.messages.length === 0 ? (
              <div className="history-empty">
                <strong>No matching messages</strong>
                <p>Try another keyword, widen the date range, or clear the filters.</p>
              </div>
            ) : (
              <ol className="history-results" aria-label="Search results">
                {data.messages.map((message) => (
                  <li key={message._id}>
                    <article
                      className={`message ${message.senderRole === 'agent' ? 'outgoing' : 'incoming'}`}
                    >
                      <strong>{message.senderRole === 'agent' ? 'Support team' : 'Guest'}</strong>
                      <p>{message.body}</p>
                      <time dateTime={message.createdAt}>
                        {new Date(message.createdAt).toLocaleString(undefined, {
                          timeZone: 'UTC',
                          timeZoneName: 'short',
                        })}
                      </time>
                    </article>
                  </li>
                ))}
              </ol>
            )}
            <nav className="history-pagination" aria-label="Message history pages">
              <button
                className="secondary"
                disabled={pagination.page <= 1}
                onClick={() =>
                  setQuery((previous) => ({
                    ...previous,
                    page: previous.page - 1,
                    snapshot: pagination.snapshot,
                  }))
                }
              >
                Previous messages
              </button>
              <span>
                Page {pagination.page} of {pagination.pages}
              </span>
              <button
                className="secondary"
                disabled={pagination.page >= pagination.pages}
                onClick={() =>
                  setQuery((previous) => ({
                    ...previous,
                    page: previous.page + 1,
                    snapshot: pagination.snapshot,
                  }))
                }
              >
                Next messages
              </button>
            </nav>
          </>
        )
      )}
    </section>
  );
}
