import { GENE_COUNT } from './genome';
import { TR } from './traits';

/** Organismos em Structure-of-Arrays: nenhum objeto JS por indivíduo. */
export class OrganismPool {
  readonly cap: number;
  used = 0; // marca d'água alta
  count = 0;
  nextId = 1;
  alive: Uint8Array;
  id: Uint32Array;
  parent: Uint32Array;
  species: Uint32Array;
  gen: Uint32Array;
  born: Uint32Array;
  age: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  mass: Float64Array;
  energy: Float64Array;
  cell: Int32Array;
  genes: Float32Array;
  tr: Float32Array;
  private free: Int32Array;
  private freeTop = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.alive = new Uint8Array(cap);
    this.id = new Uint32Array(cap);
    this.parent = new Uint32Array(cap);
    this.species = new Uint32Array(cap);
    this.gen = new Uint32Array(cap);
    this.born = new Uint32Array(cap);
    this.age = new Uint32Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.mass = new Float64Array(cap);
    this.energy = new Float64Array(cap);
    this.cell = new Int32Array(cap);
    this.genes = new Float32Array(cap * GENE_COUNT);
    this.tr = new Float32Array(cap * TR);
    this.free = new Int32Array(cap);
  }

  alloc(): number {
    let i: number;
    if (this.freeTop > 0) i = this.free[--this.freeTop];
    else if (this.used < this.cap) i = this.used++;
    else return -1;
    this.alive[i] = 1;
    this.id[i] = this.nextId++;
    this.count++;
    return i;
  }

  release(i: number): void {
    this.alive[i] = 0;
    this.count--;
    this.free[this.freeTop++] = i;
  }

  exportFree(): Int32Array {
    return this.free.slice(0, this.freeTop);
  }
  importFree(f: ArrayLike<number>): void {
    this.freeTop = f.length;
    for (let i = 0; i < f.length; i++) this.free[i] = f[i];
    this.count = 0;
    for (let i = 0; i < this.used; i++) if (this.alive[i]) this.count++;
  }

  /** Reconstrói a lista livre (após carregar um save). */
  rebuildFreeList(): void {
    this.freeTop = 0;
    this.count = 0;
    for (let i = 0; i < this.used; i++) {
      if (this.alive[i]) this.count++;
      else this.free[this.freeTop++] = i;
    }
  }
}
