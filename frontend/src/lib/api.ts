import axios, { AxiosError } from "axios";

// Empty = same origin (nginx / dev proxy forwards /api to the backend).
const BASE = ((process.env.REACT_APP_BACKEND_URL as string | undefined) || "").replace(/\/$/, "");
export const API = `${BASE}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true,
  paramsSerializer: {
    indexes: null, // serialize arrays as repeated keys: tags=a&tags=b
  },
});

export default api;

/** Full-page redirect to Google sign-in (optionally also asking for Calendar access). */
export function googleSignIn(opts: { next?: string; calendar?: boolean } = {}) {
  const params = new URLSearchParams();
  params.set("next", opts.next || "/");
  if (opts.calendar) params.set("calendar", "true");
  window.location.href = `${API}/auth/google/login?${params.toString()}`;
}

export function formatApiError(err: unknown): string {
  const axErr = err as AxiosError<{ detail?: unknown }>;
  const detail = axErr?.response?.data?.detail;
  if (detail == null) return axErr?.message || "Bir hata oluştu";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: any) => (e?.msg ? e.msg : JSON.stringify(e)))
      .join(" ");
  }
  return String(detail);
}
