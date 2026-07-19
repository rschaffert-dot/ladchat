/** Domäntyper som speglar databasschemat (Fas 1). */

export type Role = "owner" | "member";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
}

export type BeerGlassSize = "galopp" | "storstark" | "slaktarbagare";

export interface Group {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  beer_glass_size: BeerGlassSize | null;
  beer_fill_cl: number;
  beer_round_started_at: string | null;
  beer_duration_minutes: number | null;
}

export interface Message {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface MessageWithAuthor extends Message {
  author_name: string;
}
