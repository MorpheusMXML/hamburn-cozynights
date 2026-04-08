// src/lib/types.ts
export interface Bed {
  id: string;
  label: string;
  occupied: boolean;
}

export interface House {
  id: string;
  name: string;
  x: number; // Logische X-Koordinate (0-1000)
  y: number; // Logische Y-Koordinate (0-700)
  status: 'available' | 'full' | 'frei' | 'besetzt';
  beds: Bed[];
}