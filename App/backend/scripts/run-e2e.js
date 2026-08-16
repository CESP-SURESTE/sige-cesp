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
//
// `--runInBand` (corregido 2026-08-16, debugging sistemático — ver
// `documentacion_de_agentes/ESTADO.md`): las 11+ suites e2e corren cada una
// su propia app NestJS completa contra la DB REAL de Supabase (no hay DB de
// test separada). En paralelo (default de Jest, un worker por suite), todas
// abren su propio pool de conexiones de Prisma contra el *pooler* remoto
// (`aws-0-us-east-2.pooler.supabase.com:6543`) al mismo tiempo — eso agota
// las conexiones concurrentes disponibles y produce fallas intermitentes
// reales (`PrismaClientInitializationError: Can't reach database server`,
// no solo timeouts de hook). Confirmado con 3 corridas seriales limpias
// seguidas vs. fallas reproducibles en paralelo. Serial es más lento
// (~70s vs. ~27s) pero confiable — prioridad de este proyecto es
// estabilidad > rendimiento (CLAUDE.md global).
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const jestBin = path.join(path.dirname(require.resolve('jest/package.json')), 'bin', 'jest.js');
const configPath = path.join(__dirname, '..', 'test', 'jest-e2e.json');
const args = process.argv.slice(2);
const yaTieneRunInBand = args.some((a) => a === '--runInBand' || a === '-i');

const result = spawnSync(
  process.execPath,
  [
    '--experimental-vm-modules',
    jestBin,
    '--config',
    configPath,
    ...(yaTieneRunInBand ? [] : ['--runInBand']),
    ...args,
  ],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

process.exit(result.status ?? 1);
