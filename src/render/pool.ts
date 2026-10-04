/** Fixed-capacity object pool. Live items are items[0..count). Killing swaps with the last live item. */
export class Pool<T> {
  readonly items: T[] = [];
  count = 0;
  private rr = 0;

  constructor(
    private readonly make: () => T,
    readonly capacity: number,
  ) {}

  /** Returns a live slot (reused object — caller must overwrite every field). When full, recycles a live one. */
  spawn(): T {
    if (this.count < this.items.length) return this.items[this.count++];
    if (this.items.length < this.capacity) {
      const x = this.make();
      this.items.push(x);
      this.count++;
      return x;
    }
    this.rr = (this.rr + 1) % this.capacity;
    return this.items[this.rr];
  }

  /** Remove live item at index i (iterate backwards when killing during a loop). */
  kill(i: number): void {
    const last = --this.count;
    if (i !== last) {
      const tmp = this.items[i];
      this.items[i] = this.items[last];
      this.items[last] = tmp;
    }
  }

  clear(): void {
    this.count = 0;
  }
}
