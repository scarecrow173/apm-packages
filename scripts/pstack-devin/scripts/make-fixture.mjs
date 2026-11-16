// make-fixture.mjs — generate the throwaway consumer repo used by the
// real-CLI probes (`probe:*`). The fixture is gitignored and never
// distributed; regenerate it any time with:
//
//   node scripts/make-fixture.mjs            # -> fixtures/smoke-repo
//   node scripts/make-fixture.mjs <dir>      # -> <dir>
//
// The directory is recreated from scratch and `git init`'d with one
// baseline commit so probes can diff `git status` before/after a run.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] ?? join(here, '..', 'fixtures', 'smoke-repo'));

const files = {
  'package.json': JSON.stringify(
    {
      name: 'smoke-repo',
      version: '0.0.0',
      private: true,
      description: 'Throwaway consumer fixture for pstack-devin real-CLI probes',
      scripts: { test: 'node src/index.js' },
    },
    null,
    2,
  ) + '\n',
  'AGENTS.md': [
    '# smoke-repo',
    '',
    'Tiny fixture repo. Keep answers short.',
    '',
  ].join('\n'),
  'README.md': ['# smoke-repo', '', 'Fixture for real-CLI probes.', ''].join(
    '\n',
  ),
  'src/index.js': [
    'export function greet(name) {',
    '  return `hello ${name}`;',
    '}',
    '',
    "console.log(greet('fixture'));",
    '',
  ].join('\n'),
  'src/util.js': [
    'export function add(a, b) {',
    '  return a + b;',
    '}',
    '',
  ].join('\n'),
};

rmSync(target, { recursive: true, force: true });
for (const [rel, content] of Object.entries(files)) {
  const abs = join(target, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

const git = (args) =>
  execFileSync('git', args, { cwd: target, stdio: ['ignore', 'pipe', 'pipe'] });
git(['init', '-b', 'main']);
git(['add', '-A']);
git([
  '-c',
  'user.name=pstack-devin-probe',
  '-c',
  'user.email=probe@localhost',
  'commit',
  '-m',
  'fixture baseline',
]);

console.log(`fixture ready: ${target}`);
