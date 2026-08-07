// Wrapper para correr los tests e2e con `--experimental-vm-modules`.
//
// Por qué existe este archivo: `test/sede-guard.e2e-spec.ts` (Fase 1, Día 6)
// necesita `import()` dinámico para poder cargar `jose` y `@supabase/server`
// (paquetes ESM-only, sin build CJS) dentro de Jest — Jest solo soporta
// `import()` dinámico de verdad con el flag experimental de Node
// `--experimental-vm-modules`.
//
// Se resuelve con un wrapper de Node en vez de `NODE_OPTIONS=... jest` en el
// script de `package.json` porque esa sintaxis de variable de entorno es de
// shell POSIX — no funciona igual en PowerShell/cmd.exe (Windows es el
// entorno principal de este proyecto, ver CLAUDE.md). `child_process.spawn`
// con un `env` object es portable sin depender de sintaxis de shell ni de
// agregar `cross-env` como dependencia nueva.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const jestBin = path.join(path.dirname(require.resolve('jest/package.json')), 'bin', 'jest.js');
const configPath = path.join(__dirname, '..', 'test', 'jest-e2e.json');

const result = spawnSync(
  process.execPath,
  ['--experimental-vm-modules', jestBin, '--config', configPath, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

process.exit(result.status ?? 1);
