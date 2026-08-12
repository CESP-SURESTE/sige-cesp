# Sistema de agentes — SIGE

Cada agente trabaja solo en su carpeta (backend nunca toca frontend; admin y alumno nunca
se mezclan — ver regla 11 del `CLAUDE.md`). Al iniciar leen **solo**
`documentacion_de_agentes/ESTADO.md` de su dominio (+ `App/backend/prisma/schema.prisma`
en backend). No leen historiales ni docs a menos que la tarea lo exija (on-demand con
Grep). Las reglas y el contrato API viven en el `CLAUDE.md` raíz, siempre auto-cargado.

| Agente | Dominio | Cuándo |
|---|---|---|
| `backend-coder` | `App/backend/` | Implementar backend (NestJS + Prisma) |
| `backend-debugger` | `App/backend/` | Corregir un bug de backend |
| `admin-coder` | `App/frontend/src/app/admin/` | Vistas de administrativos |
| `admin-debugger` | `App/frontend/src/app/admin/` | Corregir bug de la vista admin |
| `alumno-coder` | `App/frontend/src/app/alumno/` | Vistas de alumno y maestro |
| `alumno-debugger` | `App/frontend/src/app/alumno/` | Corregir bug de la vista alumno/maestro |
| `qa-backend` / `qa-admin` / `qa-alumno` | su dominio | Auditar antes de cerrar; consigna veredicto en `ESTADO.md`, nunca corrige |
| `qa-frontend` | `proxy.ts`, `app/login/`, `app/cambiar-password/`, `app/no-autorizado/`, `lib/supabase/`, `lib/api/` | Auditar infraestructura de frontend sin dueño de dominio (no la cubren `qa-admin` ni `qa-alumno`); consigna veredicto en `ESTADO.md`, nunca corrige |

## Reglas operativas

- Terminal **PowerShell 7** (`pwsh`) — cmdlets nativos, no sintaxis bash. `pnpm`/`npx`/`prisma` funcionan igual.
- Ambigüedad menor: documentar el supuesto en código y continuar. Excepción: si toca una
  regla de arquitectura del `CLAUDE.md` (sección de reglas) o la separación admin/alumno,
  detenerse y preguntar.
- Bug que cruza de dominio (ej. frontend encuentra un bug de backend): reportarlo en
  `ESTADO.md`, no arreglarlo.
- QA nunca corrige código; solo audita y consigna el veredicto en `ESTADO.md`.
- No existe agente "architect": la planeación de fases se hace en conversación con el usuario.
- Reiniciar la sesión tras editar `.claude/agents/` o `.claude/settings*.json`.