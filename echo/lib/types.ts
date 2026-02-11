export interface Entry {
  id: string;
  user_id: string | null;
  message: string;
  color: string;
  shape: 'spiky' | 'smooth' | 'jagged';
  intensity: number | null;
  category: string | null;
  x: number;
  y: number;
  created_at: string;
  similarity?: number | null;
}

export interface Resonance {
  id: string;
  target_entry_id: string;
  actor_entry_id: string;
  created_at: string;
}
