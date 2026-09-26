import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Feedback is inline (Feedback.jsx), never a browser pop-up.
const SRC = join(__dirname);

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [path] : [];
  });

test('no source file calls alert(), confirm() or prompt()', () => {
  const files = sources(SRC);
  expect(files.length).toBeGreaterThan(20);

  const offenders = files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => [line, i + 1])
      .filter(([line]) => /(^|[^\w.$])(window\.)?(alert|confirm|prompt)\s*\(/.test(line))
      .map(([line, n]) => `${relative(SRC, file)}:${n}: ${line.trim()}`)
  );

  expect(offenders).toEqual([]);
});
