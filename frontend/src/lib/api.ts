import axios, { AxiosError } from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL as string;
export const API = `${BASE}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true,
  paramsSerializer: {
    indexes: null, // serialize arrays as repeated keys: tags=a&tags=b
  },
});

export default api;

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
