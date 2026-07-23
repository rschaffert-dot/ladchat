/** Domäntyper som speglar databasschemat (Fas 1). */

export type Role = "owner" | "member";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_path: string | null;
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
  energy: number;
  energy_updated_at: string;
}

export interface Message {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
  kind: "user" | "system" | "image" | "audio" | "poll";
  metadata: Record<string, unknown>;
  reply_to_id: string | null;
  edited_at?: string | null;
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

export interface AppNotification {
  id: string;
  user_id: string;
  group_id: string;
  message_id: string | null;
  kind: string;
  content: string;
  read: boolean;
  created_at: string;
}

export interface Streak {
  group_id: string;
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_checkin: string | null;
}

export type DuelStatus = "pending" | "active" | "declined" | "finished";

export interface Duel {
  id: string;
  group_id: string;
  challenger_id: string;
  opponent_id: string;
  stake: number;
  status: DuelStatus;
  winner_id: string | null;
  ends_at: string | null;
  created_at: string;
}

export interface DuelVote {
  duel_id: string;
  group_id: string;
  voter_id: string;
  voted_for: string;
  created_at: string;
}

export interface Achievement {
  code: string;
  name: string;
  emoji: string;
  description: string;
}

export interface UserAchievement {
  user_id: string;
  code: string;
  group_id: string | null;
  earned_at: string;
}

export interface PowerHour {
  id: string;
  group_id: string;
  starts_at: string;
  ends_at: string;
}

export type ActivationKind = "thumb_order" | "longest_fart";

export interface ActivationActivity {
  id: string;
  kind: ActivationKind;
  name: string;
  description: string | null;
  is_active: boolean;
  window_hours: number;
  created_by: string;
  created_at: string;
}

export type ActivationStatus = "active" | "completed";

export interface GroupActivation {
  id: string;
  group_id: string;
  activity_id: string | null;
  kind: ActivationKind;
  name: string;
  status: ActivationStatus;
  started_at: string;
  deadline_at: string;
  completed_at: string | null;
}

export interface ActivationParticipation {
  id: string;
  activation_id: string;
  user_id: string;
  media_path: string | null;
  duration_ms: number | null;
  rank: number | null;
  points_awarded: number;
  submitted_at: string;
}
