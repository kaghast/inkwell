// Domain types shared across the app

export type AuthProvider = "email" | "google";

export interface User {
  user_id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  auth_provider: AuthProvider;
  created_at: string;
}

export interface Tag {
  tag_id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface Person {
  person_id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface LocationItem {
  location_id: string;
  user_id: string;
  name: string;
  lat: number;
  lng: number;
  created_at: string;
}

export interface Note {
  note_id: string;
  user_id: string;
  title: string;
  content: string;
  date: string; // YYYY-MM-DD
  tags: string[];
  people: string[];
  area_ids?: string[];
  location_id?: string | null;
  pinned?: boolean;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  title?: string;
  content: string;
  date?: string;
  location_id?: string | null;
  area_ids?: string[];
}

/** A user-defined personal area (Ayarlar → Kişisel alanlar). */
export interface Area {
  area_id: string;
  name: string;
  color: string; // #rrggbb
  description?: string | null;
  position: number;
  note_count: number;
  created_at: string;
}

export interface GraphNote {
  note_id: string;
  title: string;
  snippet: string;
  date: string;
  area_ids: string[];
  tags: string[];
  people: string[];
}

export interface GraphData {
  areas: Area[];
  notes: GraphNote[];
}

export type CalendarCounts = Record<string, number>;

export interface GoogleEvent {
  id: string;
  summary: string;
  start: string; // RFC3339 dateTime, or YYYY-MM-DD for all-day events
  end: string;
  all_day: boolean;
  location?: string | null;
  html_link?: string | null;
}

export type Theme = "light" | "dark";

export type DashboardMode = "day" | "tag" | "person" | "location" | "area";
