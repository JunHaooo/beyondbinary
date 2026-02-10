export interface Entry {
  id: string;
  user_id: string | null;
  message: string;
  color: string;
  shape: 'spiky' | 'smooth' | 'jagged';
  x: number;
  y: number;
  created_at: string;
}

export interface Resonance {
  id: string;
  target_entry_id: string;
  actor_entry_id: string;
  created_at: string;
}
