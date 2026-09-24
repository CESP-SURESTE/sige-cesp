# Reseed completo de datos ficticios — Design

**Fecha:** 2026-09-17
**Motivado por:** al probar el feature de reseteo de contraseña, se encontró que 38 de 42 cuentas `ADMINISTRATIVO` de la DB de dev carecen de `PerfilAdministrativo` (`GET /perfil` responde 500 "El perfil de este usuario está incompleto" para esas cuentas, incluida `ricardo.pat@cesp-tizimin.edu.mx`, con la que el usuario estaba probando). Investigado a fondo: no es un bug de lógica — `seedAdministrativo` ya tiene auto-sanado desde 2026-09-10 — sino que el seed nunca se ha vuelto a correr contra esta DB desde que se agregaron varias features (grupos, materias, `tipoSangre`, avisos, calendario, emergencia). El usuario pidió ir más allá del parche mínimo: borrar la DB de dev y sembrar de nuevo con datos completos y coherentes.

## Alcance

Cubre TODO el modelo de datos relevante para un ambiente de prueba completo: personas con perfil completo (incluye `tipoSangre`, ahora requerido a nivel de aplicación desde 2026-09-07), estructura académica (carreras/salones/grupos/materias/asignaciones — compañeros de grupo reales), y módulos de actividad (teléfonos de emergencia por sede, un aviso, un evento de calendario) para que la app no se sienta vacía al navegarla.

**Fuera de alcance** (decisiones explícitas del usuario en brainstorming):
- `AdminPlataforma` — se deja intacto, no se toca.
- `MallaCurricular` — no se sube ningún PDF; la función de subida ya existe y se prueba manual cuando haga falta.
- `PermisoAdministrativo`/`Seccion` (matriz de permisos por AUXILIAR) — sin código de aplicación que lo consuma todavía (ver CLAUDE.md, tabla "CRUD por tipo de entidad"), no se siembra.
- `RegistroAuditoria` — nunca se siembra (es rastro de acciones reales, no dato de referencia).
- `Notificacion` de tipo `RECORDATORIO_EVENTO` — la genera el job de recordatorios (flag `RECORDATORIOS_HABILITADO` apagado por defecto), no el seed.

## Hallazgo clave: el seed existente ya hace más de lo esperado

`prisma/seed-helpers.ts` → `seedSede()` YA construye, de forma idempotente (upsert/findFirst+create): sede → 2 carreras → 3 materias por carrera (`ciclo: 1`) → 2 salones → 2 grupos (`cicloActual: 1`, uno por carrera) → 2 administrativos (uno `ADMIN`/`COORDINADOR_ADMINISTRATIVO`, uno `SUPER_ADMIN`/`DIRECTOR`) → 3 maestros → 8 alumnos matriculados en el grupo de su carrera vía `GrupoAlumno` (esto YA da compañeros reales) → asignación maestro↔materia vía `GrupoMateriaMaestro` (round-robin determinístico) → 2 personal de servicios. Cada persona con cuenta ya recibe 1 contacto de emergencia + una fila `InfoMedica*` (con `tieneCondicionMedica: false`).

Por lo tanto el trabajo real es **quirúrgico, no una reescritura**: agregar lo que falta sobre esta base ya sólida.

## Qué falta y cómo se agrega

### 1. `tipoSangre` en info médica

`INFO_MEDICA_DEFAULT` (constante compartida, `seed-helpers.ts:116`) no incluye `tipoSangre` → queda `null` en las ~120 filas sembradas hoy. Se reemplaza por un parámetro `tipoSangre: TipoSangre` requerido en `seedAlumno`/`seedMaestro`/`seedAdministrativo`/`seedPersonalServicios`, pasado explícitamente por cada entrada de `seed.ts`/`seed-variado.ts` (asignación variada y realista entre los 8 valores del enum, sin patrón obvio tipo "todos O+").

### 2. `TelefonoEmergenciaSede` — 3 por sede

Helper nuevo `seedTelefonoEmergencia(sedeId, etiqueta, telefono, orden)` — `findFirst` por `(sedeId, etiqueta)` + `create` si no existe (mismo patrón idempotente que el resto del archivo). Por sede: "Dirección" (el `telefono` real de la sede), "Enfermería", "Seguridad" — números ficticios plausibles del mismo LADA que la sede.

### 3. `Aviso` — 1 por sede

Helper nuevo `seedAviso({ sedeId, autorUsuarioId, titulo, cuerpo, alcanceTipo, alcanceId })`:
- `findFirst` por `(sedeId, titulo)` + skip si ya existe (idempotente).
- Crea el `Aviso`.
- Reutiliza **la función real del backend** `resolverDestinatarios` (`src/common/publicacion/alcance-publicacion.util.ts`, ya usada por `AvisosService.publicar`) para calcular destinatarios — no se reimplementa esa lógica en el seed.
- Crea una `Notificacion` (`tipo: AVISO`, `referenciaId: aviso.id`, `cuerpoCorto` = primeros 140 chars) por destinatario, igual que el fan-out real, para que el feed de notificaciones no esté vacío.

Contenido: autor = el administrativo `ADMIN` de la sede (`config.administrativos[0]`), `alcanceTipo: SEDE`, título "Bienvenida al ciclo escolar 2026", cuerpo genérico de bienvenida.

### 4. `EventoCalendario` — 1 por sede

Helper nuevo `seedEvento({ sedeId, autorUsuarioId, titulo, categoria, alcanceTipo, alcanceId, fechaInicio, horaInicio })` — `findFirst` por `(sedeId, titulo)` + skip si existe. Sin recurrencia (`recurrenciaRegla: null`). Contenido: autor = mismo administrativo `ADMIN`, categoría `EXAMEN`, alcance `SEDE`, título "Examen parcial — primer parcial", `fechaInicio` una fecha fija futura razonable (2026-10-15), `horaInicio: '09:00'`.

### 5. `reset-db.ts` — lista de tablas desactualizada

`TABLAS` (línea 86) ya incluye `materias`, pero le faltan 7 tablas agregadas al schema después de que este script se escribió: `grupo_materia_maestro`, `contador_matricula`, `notificaciones`, `eventos_calendario`, `recordatorio_enviado`, `avisos`, `telefonos_emergencia_sede`. Se agregan las 7. **`admin_plataforma` se QUITA de la lista** (decisión del usuario: esa identidad no se toca).

## Ejecución (para el usuario, no automática)

```bash
cd App/backend
npx ts-node prisma/reset-db.ts --confirmar   # borra Auth + todas las tablas (menos admin_plataforma)
SEED_DEMO_PASSWORD='...' npx prisma db seed  # reseed completo, ya con todo lo de arriba
```

Ninguno de los dos comandos corre automáticamente como parte de este plan — el plan deja el código listo; el usuario decide cuándo ejecutar el reset real contra su DB de dev (acción destructiva).

## Escala (sin cambios respecto al seed actual)

3 sedes (Mérida, Valladolid, Tizimín), mismos nombres/personas ya definidos en `seed.ts` (se reusan tal cual, solo se les agrega `tipoSangre`). Por sede: 2 carreras, 2 salones, 2 grupos, 3 materias/carrera, 2 administrativos, 3 maestros, 8 alumnos, 2 personal de servicios, 3 teléfonos de emergencia, 1 aviso, 1 evento.

## Riesgos / notas

- `reset-db.ts` sigue siendo destructivo e irreversible — el flag `--confirmar` ya existente se mantiene como única protección, sin cambios a esa salvaguarda.
- El reset borra TODAS las cuentas de Supabase Auth (incluidas las creadas manualmente en pruebas fuera del seed, ej. el alumno de prueba que el usuario dio de alta hoy con su propio correo) — esperado y aceptado por el usuario.
- Idempotencia: si `prisma db seed` se corre dos veces seguidas sin un reset en medio, no debe duplicar avisos/eventos/teléfonos — de ahí el `findFirst` guard en los 3 helpers nuevos, igual que ya hacen `materias`/`grupos`/`grupoMateriaMaestro`.
