export interface Bed {
  id: number;
  label: string;
  occupied: boolean;
}

export interface House {
  id: number;
  name: string;
  x: number;
  y: number;
  status: 'frei' | 'voll';
  beds: Bed[]; // Neue Liste der Betten pro Haus
}