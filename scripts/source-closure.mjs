// Conservative lexical closure for test fixtures. Full project builds still check every declaration.
export function sourceClosure(inputs, roots) {
  const groups = [];
  const byName = new Map();
  for (const { path, text } of inputs) {
    const starts = [...text.matchAll(/^(?:def(?: rec)?|mu)\s+([A-Za-z_][A-Za-z0-9_']*)/gm)];
    if (text.slice(0, starts[0]?.index ?? text.length).replace(/--[^\n]*/g, '').trim()) throw new Error(`Unsupported source preamble: ${path}`);
    for (const [i, start] of starts.entries()) {
      const body = text.slice(start.index, starts[i + 1]?.index ?? text.length);
      const names = [start[1], ...(start[0].startsWith('mu ') ? [...body.matchAll(/^\|\s+([A-Za-z_][A-Za-z0-9_']*)/gm)].map(m => m[1]) : [])];
      const group = { path, line: text.slice(0, start.index).split('\n').length, names, body, dependencies: [] };
      for (const name of names) {
        if (byName.has(name)) throw new Error(`Duplicate declaration: ${name}`);
        byName.set(name, group);
      }
      // Strings and comments consume their complete token before identifier scanning.
      group.dependencies = [...body.matchAll(/--[^\n]*|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_']*/g)]
        .map(m => m[0]).filter(token => !token.startsWith('--') && !token.startsWith('"'));
      groups.push(group);
    }
  }
  const selected = new Set();
  const pending = roots.map(name => {
    if (!byName.has(name)) throw new Error(`Unknown export: ${name}`);
    return byName.get(name);
  });
  while (pending.length) {
    const group = pending.pop();
    if (selected.has(group)) continue;
    selected.add(group);
    for (const name of group.dependencies) if (byName.has(name)) pending.push(byName.get(name));
  }
  const ordered = groups.filter(group => selected.has(group));
  return { text: ordered.map(group => group.body).join('\n'), declarations: ordered.map(({ path, line, names }) => ({ path, line, names })) };
}
