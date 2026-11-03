// Durable envelope queue on disk: survives offline starts and crashes; oldest dropped past the cap.
import * as fs from 'node:fs';
import * as path from 'node:path';

export class Queue {
  readonly dir: string;
  readonly maxBytes: number;
  private seq = 0;

  constructor(dir: string, maxBytes?: number) {
    this.dir = dir;
    this.maxBytes = maxBytes || 5 << 20;
    fs.mkdirSync(dir, { recursive: true });
  }

  add(buf: Buffer): void {
    const name = `${Date.now().toString().padStart(15, '0')}-${String(this.seq++).padStart(6, '0')}.env`;
    fs.writeFileSync(path.join(this.dir, name), buf);
    this.trim();
  }

  list(): string[] {
    return fs.readdirSync(this.dir).filter((n) => n.endsWith('.env')).sort();
  }

  private trim(): void {
    const names = this.list();
    let total = names.reduce((s, n) => s + fs.statSync(path.join(this.dir, n)).size, 0);
    for (const n of names) {
      if (total <= this.maxBytes || n === names[names.length - 1]) break;
      total -= fs.statSync(path.join(this.dir, n)).size;
      fs.unlinkSync(path.join(this.dir, n));
    }
  }

  /** Send oldest first. 2xx and permanent 4xx (not 408/429) drop the file; anything else stops the drain. */
  async drain(send: (body: Buffer) => Promise<number>): Promise<void> {
    for (const n of this.list()) {
      const f = path.join(this.dir, n);
      let status: number;
      try {
        status = await send(fs.readFileSync(f));
      } catch {
        return;
      }
      if ((status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 408 && status !== 429)) {
        fs.unlinkSync(f);
      } else {
        return;
      }
    }
  }
}
