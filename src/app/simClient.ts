import type { SaveData } from '../core/serialize';
import type { Suggestion } from '../core/validate';
import type { FromWorker, InspectInfo, CellInfo, StatsPayload, ToWorker } from '../worker/protocol';

export type FrameMsg = Extract<FromWorker, { t: 'frame' }>;

/** Ponte entre a interface e o worker de simulação. */
export class SimClient {
  private worker: Worker;
  onFrame: (f: FrameMsg) => void = () => {};
  onStats: (s: StatsPayload) => void = () => {};
  onReady: (w: number, h: number) => void = () => {};
  onInspect: (i: InspectInfo | null) => void = () => {};
  onCell: (c: CellInfo) => void = () => {};
  private pending = new Map<number, (v: any) => void>();
  private req = 1;

  constructor() {
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      switch (m.t) {
        case 'ready': this.onReady(m.w, m.h); break;
        case 'frame': this.onFrame(m); this.send({ t: 'ack' }); break;
        case 'stats': this.onStats(m); break;
        case 'inspect': this.onInspect(m.info); break;
        case 'cell': this.onCell(m.info); break;
        case 'save': this.pending.get(m.reqId)?.(m.save); this.pending.delete(m.reqId); break;
        case 'verdict': this.pending.get(m.reqId)?.({ ok: m.ok, reason: m.reason }); this.pending.delete(m.reqId); break;
      }
    };
  }

  send(m: ToWorker): void {
    this.worker.postMessage(m);
  }
  requestSave(): Promise<SaveData> {
    const id = this.req++;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.send({ t: 'save', reqId: id });
    });
  }
  suggest(s: Suggestion, auto = false): Promise<{ ok: boolean; reason: string }> {
    const id = this.req++;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.send({ t: 'suggest', reqId: id, s, auto });
    });
  }
}
