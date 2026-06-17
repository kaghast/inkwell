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
  location_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  title?: string;
  content: string;
  date?: string;
  location_id?: string | null;
}

export type CalendarCounts = Record<string, number>;

export type Theme = "light" | "dark";

export type DashboardMode = "day" | "tag" | "person" | "location";
