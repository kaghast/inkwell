import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;
export const API = `${BASE}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export default api;

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || "Bir hata oluştu";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => (e?.msg ? e.msg : JSON.stringify(e))).join(" ");
  }
  return String(detail);
}
