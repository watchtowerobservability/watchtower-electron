'use strict';
// Durable envelope queue on disk: survives offline starts and crashes; oldest dropped past the cap.
const fs = require('node:fs');
const path = require('node:path');

class Queue {
  constructor(dir, maxBytes) {
    this.dir = dir;
    this.maxBytes = maxBytes || 5 << 20;
    this.seq = 0;
    fs.mkdirSync(dir, { recursive: true });
  }

  add(buf) {
    const name = `${Date.now().toString().padStart(15, '0')}-${String(this.seq++).padStart(6, '0')}.env`;
    fs.writeFileSync(path.join(this.dir, name), buf);
    this._trim();
  }

  list() {
    return fs.readdirSync(this.dir).filter((n) => n.endsWith('.env')).sort();
  }

  _trim() {
    const names = this.list();
    let total = names.reduce((s, n) => s + fs.statSync(path.join(this.dir, n)).size, 0);
    for (const n of names) {
      if (total <= this.maxBytes || n === names[names.length - 1]) break;
      total -= fs.statSync(path.join(this.dir, n)).size;
      fs.unlinkSync(path.join(this.dir, n));
    }
  }

  /** Send oldest first. 2xx and permanent 4xx (not 408/429) drop the file; anything else stops the drain. */
  async drain(send) {
    for (const n of this.list()) {
      const f = path.join(this.dir, n);
      let status;
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

module.exports = { Queue };
