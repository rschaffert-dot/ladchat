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
  kind: "user" | "system";
  metadata: Record<string, unknown>;
}

export interface MessageWithAuthor extends Message {
  author_name: string;
}

export type ReactionKey = "respekt" | "skal" | "eld" | "get" | "skalle";

export interface MessageReaction {
  id: string;
  message_id: string;
  group_id: string;
  user_id: string;
  reaction: ReactionKey;
  created_at: string;
}

export type TournamentStatus =
  | "draft"
  | "registration_open"
  | "active"
  | "completed";

export interface Tournament {
  id: string;
  name: string;
  description: string | null;
  entry_fee_ore: number;
  prize_pool_ore: number;
  status: TournamentStatus;
  created_by: string;
  created_at: string;
}

export type PaymentStatus = "pending" | "paid" | "refunded" | "waived";

export interface TournamentEntry {
  id: string;
  tournament_id: string;
  group_id: string;
  payment_status: PaymentStatus;
  payment_reference: string | null;
  points: number;
  registered_by: string;
  created_at: string;
}

export type ChallengeStatus =
  | "draft"
  | "open"
  | "picks_locked"
  | "distributed"
  | "voting"
  | "scored"
  | "completed";

export interface Challenge {
  id: string;
  tournament_id: string;
  title: string;
  description: string | null;
  status: ChallengeStatus;
  submission_deadline_at: string | null;
  voting_deadline_at: string | null;
  created_by: string;
  created_at: string;
}

export interface ChallengeSubmission {
  id: string;
  challenge_id: string;
  group_id: string;
  user_id: string;
  image_path: string;
  caption: string | null;
  created_at: string;
}

export interface ChallengePickVote {
  id: string;
  challenge_id: string;
  group_id: string;
  voter_id: string;
  submission_id: string;
  created_at: string;
}

export interface ChallengeDistribution {
  id: string;
  challenge_id: string;
  from_group_id: string;
  to_group_id: string;
  submission_id: string;
  created_at: string;
}

export interface ChallengeResult {
  id: string;
  challenge_id: string;
  group_id: string;
  aggregate_vote_score: number;
  points_awarded: number;
  created_at: string;
}
