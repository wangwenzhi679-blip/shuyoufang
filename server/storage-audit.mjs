import fs from 'node:fs/promises';
import path from 'node:path';

export class StorageAudit {
  constructor(db, { uploadRoot, imageRoot }, { ttl = 60000, now = Date.now, stat = fs.stat } = {}) {
    Object.assign(this, { db, uploadRoot, imageRoot, ttl, now, stat });
    this.cached = null;
    this.pending = null;
    this.cachedAt = 0;
  }
  read(force = false) {
    if (this.pending) return this.pending;
    if (!force && this.cached && this.now() - this.cachedAt < this.ttl)
      return Promise.resolve(this.cached);
    this.pending = this.scan()
      .then((result) => {
        this.cached = result;
        this.cachedAt = this.now();
        return result;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  async scan() {
    const result = { materialBytes: 0, imageBytes: 0, missingFiles: 0 };
    for (const [table, root, total] of [
      ['course_materials', this.uploadRoot, 'materialBytes'],
      ['note_attachments', this.imageRoot, 'imageBytes'],
    ]) {
      let after = 0;
      while (true) {
        const [rows] = await this.db.execute(
          `SELECT id,stored_name FROM ${table} WHERE id>? ORDER BY id LIMIT 256`,
          [after],
        );
        if (!rows.length) break;
        for (let offset = 0; offset < rows.length; offset += 16) {
          await Promise.all(
            rows.slice(offset, offset + 16).map(async (row) => {
              const name = row.stored_name;
              if (!name || path.basename(name) !== name || /[\\/]/.test(name)) {
                result.missingFiles++;
                return;
              }
              try {
                const info = await this.stat(path.join(root, name));
                if (info.isFile()) result[total] += info.size;
                else result.missingFiles++;
              } catch (error) {
                if (['ENOENT', 'ENOTDIR'].includes(error.code)) result.missingFiles++;
                else throw error;
              }
            }),
          );
        }
        after = rows.at(-1).id;
      }
    }
    return { ...result, checkedAt: new Date(this.now()).toISOString() };
  }
}
