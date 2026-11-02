import { P } from './params';

export type EventType =
  | 'speciation'
  | 'extinction'
  | 'mass_extinction'
  | 'bloom'
  | 'crash'
  | 'eruption'
  | 'impact'
  | 'climate'
  | 'user'
  | 'dominance'
  | 'milestone'
  | 'total_extinction'
  | 'anagenesis';

export interface SimEvent {
  tick: number;
  type: EventType;
  title: string;
  text: string;
  speciesId?: number;
  magnitude?: number;
}

export class EventLog {
  items: SimEvent[] = [];
  max = 2000;
  add(e: SimEvent): void {
    this.items.push(e);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }
}

/** Séries temporais com decimação automática (mantém o histórico inteiro em memória limitada). */
export class History {
  ticks: number[] = [];
  series: Record<string, number[]> = {};
  stride = 1;
  constructor(public keys: string[]) {
    for (const k of keys) this.series[k] = [];
  }
  push(tick: number, values: Record<string, number>): void {
    this.ticks.push(tick);
    for (const k of this.keys) this.series[k].push(values[k] ?? 0);
    if (this.ticks.length > P.HISTORY_MAX) {
      const dec = (a: number[]) => a.filter((_, i) => i % 2 === 0);
      this.ticks = dec(this.ticks);
      for (const k of this.keys) this.series[k] = dec(this.series[k]);
      this.stride *= 2;
    }
  }
  last(k: string): number {
    const s = this.series[k];
    return s.length ? s[s.length - 1] : 0;
  }
}

export const HISTORY_KEYS = [
  'pop', 'species', 'biomass', 'nutrient', 'detritus', 'reservoir', 'temp',
  'nPhoto', 'nMixo', 'nOsmo', 'nPred', 'births', 'deaths',
  'mSize', 'mPhoto', 'mOsmo', 'mPred', 'mMotil', 'mDef', 'mTopt', 'mMeta', 'mTtol',
];
