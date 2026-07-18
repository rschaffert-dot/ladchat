/** Domäntyper som speglar databasschemat (Fas 1). */

export type Role = "owner" | "member";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
}

export interface Message {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

/** Meddelande berikat med avsändarens visningsnamn för chatt-UI. */
export interface MessageWithAuthor extends Message {
  author_name: string;
}
