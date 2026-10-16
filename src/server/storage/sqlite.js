import { DatabaseSync } from 'node:sqlite';

export function createNodeDatabase(path, options = {}) {
  const sqlite = new DatabaseSync(path, options);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return {
    async all(sql, params = []) { return sqlite.prepare(sql).all(...params).map(row => ({ ...row })); },
    async exec(sql) { sqlite.exec(sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(({ sql, params = [] }) => {
          const statement = sqlite.prepare(sql);
          if (statement.columns().length) {
            const before = sqlite.prepare('SELECT total_changes() AS count').get().count;
            const rows = statement.all(...params).map(row => ({ ...row }));
            return { changes: Number(sqlite.prepare('SELECT total_changes() AS count').get().count - before), results: rows };
          }
          return { changes: Number(statement.run(...params).changes) };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); },
  };
}
