import { splitSql } from './sql.js';
import { ContentError } from '../../admin/content-model.js';

function successful(result) {
  if (result?.success === false) throw new Error(result.error || 'D1 operation failed.');
  return result;
}

export function createD1Database(binding) {
  const maxRowBytes = 2_000_000;
  function checkParameters(params = []) {
    for (const value of params) {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? value.byteLength : 0;
      if (bytes > maxRowBytes) throw new ContentError('数据超过 D1 单个字符串或对象大小限制，请使用 Node / SQLite 存储。', 413, 'row_limit');
    }
  }
  const prepare = (sql, params = []) => binding.prepare(sql).bind(...params);
  return {
    maxBatchStatements: 40,
    maxRowBytes,
    async all(sql, params = []) { checkParameters(params); return successful(await prepare(sql, params).all()).results ?? []; },
    async exec(sql) {
      const statements = splitSql(sql);
      if (statements.length) (await binding.batch(statements.map(statement => prepare(statement)))).forEach(successful);
    },
    async batch(statements) {
      if (statements.length > 40) throw new ContentError('数据库批次超出当前部署的原子写入限制。', 413, 'batch_limit');
      statements.forEach(statement => checkParameters(statement.params));
      const result = await binding.batch(statements.map(({ sql, params }) => prepare(sql, params)));
      return result.map(value => {
        successful(value);
        return { changes: value.meta?.changes ?? 0, ...(value.results ? { results: value.results } : {}) };
      });
    },
  };
}
