export async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        data?.message || 'Support is temporarily unavailable. Please try again.',
      );
      error.status = response.status;
      throw error;
    }
    if (!data) throw new Error('The server returned an invalid response.');
    return data;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('The request timed out. Check your conversations before sending again.');
    if (error instanceof TypeError)
      throw new Error('Cannot reach support. Please check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
