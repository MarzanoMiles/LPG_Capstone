const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const PUBLIC_AUTH_PATHS = new Set(['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/reset-password/validate', '/contact']);
const SESSION_MESSAGE = 'Your session is missing or expired. Please sign in again.';

function expireSession(token) {
  // A late response from a previous session must not clear a newer login.
  if (localStorage.getItem('token') !== token) return;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.dispatchEvent(new CustomEvent('auth:session-expired', { detail: { message: SESSION_MESSAGE } }));
}

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("token");
  const requiresSession = !PUBLIC_AUTH_PATHS.has(path.split('?')[0]);
  if (requiresSession && (!token?.trim() || ['null', 'undefined'].includes(token.trim()))) {
    expireSession(token);
    const error = new Error(SESSION_MESSAGE);
    error.status = 401;
    throw error;
  }

  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (requiresSession) headers.set('Authorization', `Bearer ${token.trim()}`);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.ok && options.responseType === 'blob') return res.blob();

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (requiresSession && res.status === 401) expireSession(token);
    const error = new Error(requiresSession && res.status === 401 ? SESSION_MESSAGE : data.error || "Request failed");
    error.status = res.status;
    throw error;
  }
  return data;
}
