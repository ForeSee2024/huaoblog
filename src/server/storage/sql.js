// D1.exec treats newlines as statement separators; prepare each complete statement.
export function splitSql(source) {
  const statements = [];
  let current = '', quote = '', comment = '';
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (comment === '--') { if (char === '\n') { comment = ''; current += ' '; } continue; }
    if (comment === '/*') { if (char === '*' && next === '/') { comment = ''; current += ' '; index++; } continue; }
    if (quote) {
      current += char;
      if (char === quote) { if (next === quote) { current += next; index++; } else quote = ''; }
      continue;
    }
    if (char === '-' && next === '-') { comment = '--'; index++; continue; }
    if (char === '/' && next === '*') { comment = '/*'; index++; continue; }
    if (["'", '"', '`'].includes(char)) quote = char;
    if (char === '[') quote = ']';
    if (char === ';') { if (current.trim()) statements.push(current.trim()); current = ''; }
    else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
