# Bot de soporte SIGE

**Fecha:** 2026-09-24
**Estado:** aprobado, pendiente de implementación
**Alcance:** widget de chat flotante en `app/admin/` y `app/maestro/` (no `app/alumno/`), con dos funciones — FAQ de ayuda y reporte de bugs — más su panel de administración en `app/plataforma/`.

## Motivación

Hoy no existe ningún canal dentro de SIGE para que un administrativo o maestro (a) resuelva dudas de uso sin escribirle directo al usuario, o (b) reporte una falla real del sistema. El usuario quiere enterarse de bugs en el momento (Telegram) y tener un registro persistente y consultable (DB, visible desde plataforma) — sin depender de mensajes sueltos por WhatsApp/email.

## Decisiones de diseño (del brainstorming)

- **Un solo widget, dos modos explícitos por botón** — "Necesito ayuda" y "Tengo un problema". El bot NO infiere la intención (evita la complejidad de detección de intención de un chatbot con LLM).
- **"Necesito ayuda" = FAQ hardcodeado** — árbol fijo en el código (categorías → preguntas → respuesta), sin backend, sin LLM, sin costo por uso. Prioriza estabilidad y costo sobre "inteligencia" (coherente con la prioridad técnica del usuario: estabilidad > mantenibilidad > costo > ... > escalabilidad).
- **"Tengo un problema" = formulario simple** — descripción libre + captura de pantalla opcional adjuntada a mano (`<input type="file">`, el usuario toma su propio screenshot). Se descartó captura automática (`html2canvas`) por agregar una dependencia nueva y no capturar fiel en todos los casos (mismo tipo de problema ya documentado con `backdrop-blur-sm`).
- **Kill switch fácil y central** — un solo toggle en `app/plataforma/soporte/`, respaldado en DB (no env var — cambiar un env var implica tocar `.env` en Render + redeploy, no es "fácil"). Apaga TODO el bot (ayuda + reporte) a la vez, no hay interruptores independientes por modo.
- **Defensa en profundidad** — el frontend oculta el botón si el toggle está apagado, pero el backend también rechaza `POST /soporte/reportes` si `activo: false`, por si alguien pega directo al endpoint.
- **Telegram es un aviso, la DB es la fuente de verdad** — el envío a Telegram es best-effort (mismo criterio que Mailgun en `altaPersona`): si falla, se loguea (regla 12) pero el reporte ya quedó guardado y visible en plataforma. Nunca al revés.
- **Con foto inline en Telegram** — si el reporte trae captura, el mensaje de Telegram la incluye directo (`sendPhoto` + caption), no solo un link.
- **Reportes con estatus** — `NUEVO` / `EN_REVISION` / `RESUELTO`, editable desde plataforma vía un `<select>` por fila (no hace falta modal — 3 valores sin validación cruzada).
- **Fuera de alcance a propósito:** LLM/IA real en el modo ayuda; FAQ editable desde plataforma (queda hardcodeada, cambiarla es un cambio de código normal); notificar de vuelta al reportante cuando cambia el estatus de su reporte; adjuntar más de una captura; alumno (el widget no aparece en `app/alumno/`); toggles independientes por modo (ayuda vs. reporte).

## Modelo de datos

### 1. Migración — `ConfiguracionSoporte`, `ReporteBug`, `EstatusReporteBug`

```prisma
enum EstatusReporteBug {
  NUEVO
  EN_REVISION
  RESUELTO
}

model ConfiguracionSoporte {
  id        String   @id @default("global")
  activo    Boolean  @default(true)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("configuracion_soporte")
}

model ReporteBug {
  id                 String            @id @default(uuid())
  sedeId             String            @map("sede_id")
  sede               Sede              @relation(fields: [sedeId], references: [id])
  usuarioId          String            @map("usuario_id")
  usuario            Usuario           @relation(fields: [usuarioId], references: [id])
  descripcion        String
  capturaStoragePath String?           @map("captura_storage_path")
  estatus            EstatusReporteBug @default(NUEVO)
  createdAt          DateTime          @default(now()) @map("created_at")
  updatedAt          DateTime          @updatedAt @map("updated_at")

  @@index([estatus, createdAt])
  @@map("reportes_bug")
}
```

`ConfiguracionSoporte` es un singleton real — `id` con default literal `'global'` (no UUID), una sola fila sembrada por la propia migración (`INSERT ... ON CONFLICT DO NOTHING`). El service SIEMPRE opera contra `id: 'global'` vía `upsert`, nunca crea una fila nueva. Precedente de "tabla de configuración de un solo valor" nuevo en el proyecto — no hay uno igual hoy (`ContadorMatricula` es multi-fila, una por año).

`ReporteBug.capturaStoragePath` nullable — mismo criterio que `Usuario.fotoStoragePath`/`MallaCurricular`. RLS `sede_isolation_reportes_bug` directa por `sede_id`, mismo patrón que el resto de tablas de negocio (regla 2). `ConfiguracionSoporte` sin RLS por sede (no tiene `sedeId`, es global) — mismo criterio que `AdminPlataforma`/`Sede`.

`prisma migrate dev` sigue roto en el repo (`P3006`) — generar con `prisma migrate diff` + aplicar con `migrate deploy`, mismo flujo que las migraciones recientes.

### 2. Bucket de Storage — script permanente `prisma/crear-bucket-reportes-bug.ts`

Calco de `prisma/crear-bucket-fotos-perfil.ts` (idempotente, permanente):

```ts
const NOMBRE_BUCKET = 'reportes-bug';
// createBucket(NOMBRE_BUCKET, { public: false, fileSizeLimit: '3MB',
//   allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] })
```

## Backend

### 1. `SoporteService` — módulo nuevo `src/soporte/`

Mismo patrón de import dinámico + caché de `createAdminClient` que `FotoPerfilService`/`MallaCurricularService` para las operaciones de Storage.

```ts
class SoporteService {
  // obtenerConfig(): Promise<{ activo: boolean }>
  // actualizarConfig(activo: boolean, adminPlataformaId: string): Promise<{ activo: boolean }>
  // crearReporte(sedeId, usuarioId, descripcion, archivo?): Promise<ReporteBug>
  // listarReportes(estatus?, page, limit): Promise<{ data, page, limit, total }>
  // cambiarEstatus(id: string, estatus: EstatusReporteBug, adminPlataformaId: string): Promise<{ ok: true }>
}
```

**`obtenerConfig`:** `configuracionSoporte.upsert({ where: { id: 'global' }, create: { id: 'global' }, update: {} })` — garantiza que la fila exista incluso si la migración de seed falló, sin necesitar un `findFirstOrThrow` defensivo aparte.

**`actualizarConfig`:** `upsert` con `activo` nuevo + `RegistroAuditoria` (`accion: EDICION`, `entidad: 'ConfiguracionSoporte'`, `entidadId: 'global'`, `adminPlataformaId`, sin `sedeId` — es global, mismo criterio que otras acciones de `AdminPlataforma` sin sede asociada). Mismo criterio que foto de perfil: reusa `EDICION`, no amerita un valor de enum nuevo.

**`crearReporte`:** body multipart — campo de texto `descripcion` (requerido, no vacío → `400 VALIDATION_ERROR` si falta) + campo de archivo opcional `captura`.
1. `obtenerConfig()` — si `activo: false` → rechaza con código de dominio `SOPORTE_DESACTIVADO` (409 CONFLICT).
2. Si viene `archivo`: validar `mimetype` en la whitelist (`image/jpeg`/`image/png`/`image/webp`) → `400 VALIDATION_ERROR` si no (mismo patrón que `FotoPerfilService.subir`). `storagePath = \`${sedeId}/${randomUUID()}.${extension}\`` (no hay "reemplazo" como en foto de perfil — cada reporte es un archivo nuevo, sin upsert).
3. Subir a `reportes-bug` si aplica → `500 SERVER_ERROR` logueado si Storage falla (regla 12).
4. `reporteBug.create({ sedeId, usuarioId, descripcion, capturaStoragePath, estatus: NUEVO })`. Sin auditoría — mismo criterio que `GET /personas/:id` (no es una acción sobre OTRA persona, es autogestión del propio actor sobre su propio reporte).
5. Después de crear (fuera de cualquier transacción): best-effort `TelegramService.enviarReporteBug(...)` — try/catch propio del service, loguea con `console.error` si falla (regla 12), nunca relanza.
6. Retorna el `ReporteBug` creado.

**`listarReportes`:** cross-sede (el actor es `AdminPlataforma`, sin sede propia — mismo mecanismo ya usado por `GET /platform-admin/auditoria`/`resumen`), incluye `sede.nombre` y `usuario` (nombre completo) resueltos en el mismo query (`include`), y `capturaUrl` firmada en batch (900s, mismo patrón que `fotoUrl`) solo para los items de la página actual que tengan `capturaStoragePath`.

**`cambiarEstatus`:** valida `estatus` contra el enum (`400 VALIDATION_ERROR` si no matchea) + `update` + `RegistroAuditoria` (`accion: EDICION`, `entidad: 'ReporteBug'`, `entidadId: id`, `adminPlataformaId`, `sedeId` del reporte).

### 2. `TelegramService` — módulo nuevo `src/telegram/`

Mismo criterio que `MailService`: cliente mínimo vía `fetch` nativo, sin SDK (`node-telegram-bot-api` no hace falta para dos llamadas).

```ts
export const TELEGRAM_FETCH_OVERRIDE = 'TELEGRAM_FETCH_OVERRIDE';

export interface EnviarReporteBugParams {
  descripcion: string;
  nombreReportante: string;
  sedeNombre: string;
  capturaUrl?: string; // signed URL ya firmada por SoporteService
}

class TelegramService {
  async enviarReporteBug(params: EnviarReporteBugParams): Promise<void>
}
```

- Lee `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` del entorno — si faltan, lanza (mismo criterio que `MailService` con `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`: es responsabilidad del caller (`SoporteService.crearReporte`) decidir que es best-effort).
- Sin `capturaUrl`: `POST https://api.telegram.org/bot{token}/sendMessage` con `chat_id` + `text` (descripción + sede + reportante).
- Con `capturaUrl`: `POST https://api.telegram.org/bot{token}/sendPhoto` con `chat_id` + `photo: capturaUrl` (Telegram descarga la imagen de la URL firmada directo, sin que el backend tenga que bajar/resubir el binario) + `caption` (mismo texto que `sendMessage`, límite 1024 caracteres de Telegram — truncar la descripción si excede, con `...`).
- Sin flag de "envíos habilitados" tipo `MAILGUN_ENVIOS_HABILITADO` — el toggle de `ConfiguracionSoporte.activo` ya cumple ese rol a nivel de `SoporteService.crearReporte` (si está apagado, nunca se llega a llamar `TelegramService`).

### 3. Endpoints nuevos — `SoporteController`

```ts
@Controller('soporte')
export class SoporteController {
  @Get('config')
  @UseGuards(SedeGuard, RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  async obtenerConfig() { ... } // 200 { data: { activo } }

  @Patch('config')
  @UseGuards(PlatformAdminGuard)
  async actualizarConfig(@Body() dto, @PlatformAdminActual() adminId) { ... } // 200 { data: { activo } }

  @Post('reportes')
  @UseGuards(SedeGuard, RolesGuard)
  @Roles(RolUsuario.ADMINISTRATIVO, RolUsuario.MAESTRO)
  @UseInterceptors(FileInterceptor('captura', { limits: { fileSize: 3 * 1024 * 1024 } }))
  @UseFilters(ArchivoMuyGrandeFilter)
  async crearReporte(@Body() dto, @UploadedFile() file, @SedeActual() sedeId, @ActorUsuarioId() usuarioId) { ... } // 201 { data: ReporteBug }

  @Get('reportes')
  @UseGuards(PlatformAdminGuard)
  async listarReportes(@Query() query) { ... } // 200 { data, page, limit, total }
  // query: estatus? (EstatusReporteBug), page (default 1), limit (default 20, máx 100) — mismo shape que GET /personas

  @Patch('reportes/:id/estatus')
  @UseGuards(PlatformAdminGuard)
  async cambiarEstatus(@Param('id') id, @Body() dto, @PlatformAdminActual() adminId) { ... } // 200 { data: { ok: true } }
}
```

`ArchivoMuyGrandeFilter` (hoy en `src/malla-curricular/`) se reusa tal cual — mismo filtro que ya usan `malla-curricular`/`foto-perfil`, sin duplicarlo.

Código de dominio nuevo: `SOPORTE_DESACTIVADO` (409 CONFLICT, `POST /soporte/reportes` con `activo: false`) — se documenta en la sección "Contrato de API" de `CLAUDE.md` al cerrar. Sin código nuevo para el resto — reusa `VALIDATION_ERROR`/`NOT_FOUND`/`UNAUTHORIZED`.

## Frontend

### 1. `lib/api/soporte.ts` (compartido, sin dueño de árbol — igual que `foto-perfil.ts`)

```ts
export function obtenerConfigSoporte(): Promise<{ activo: boolean }>
export function actualizarConfigSoporte(activo: boolean): Promise<{ activo: boolean }>
export function crearReporteBug(descripcion: string, captura?: File): Promise<ReporteBug>
export function listarReportesBug(params): Promise<{ data: ReporteBug[]; page; limit; total }>
export function cambiarEstatusReporteBug(id: string, estatus: string): Promise<{ ok: true }>
```

### 2. `BotSoporte` — duplicado por árbol (regla 11)

`components/{admin,maestro}/ui/shell/BotSoporte.tsx` — mismo componente, 2 copias (ningún import cruzado). `useQuery(['soporte','config'])` decide si renderiza el botón flotante (`null` si `activo: false` o mientras carga — nunca un flash del botón que luego desaparece).

Montado como **sibling directo de `<Topbar>`**, dentro del `<div className="flex min-h-screen ...">` raíz de `AdminShell`/su equivalente de maestro — nunca dentro del `<header>` (`backdrop-blur-sm` crea containing block para `position: fixed` y recorta cualquier overlay flotante anidado ahí, bug ya documentado y ya vivido con el botón de pánico de Emergencia, retirado por esto mismo el 2026-09-08/corregido en docs 2026-09-22).

**Estados del panel:**
1. Cerrado — solo el botón flotante (ícono de chat, esquina inferior derecha).
2. Abierto, menú inicial — dos botones: "Necesito ayuda" / "Tengo un problema".
3. Modo ayuda — lista de categorías (array hardcodeado en el propio componente) → preguntas de esa categoría → respuesta en texto, con botón "atrás".
4. Modo reporte — `<textarea>` descripción (requerida) + `<input type="file">` opcional (mismo `accept`/límite/validación de tipo que el modal de foto de perfil) → botón "Enviar". Tras éxito: mensaje de confirmación breve + auto-cierre del panel (mismo patrón que `SubirMallaModal`, 1.5s). Si el backend responde `SOPORTE_DESACTIVADO` (carrera entre que el usuario abrió el panel y alguien lo apagó desde plataforma), mostrar el error y no reintentar — no debería pasar casi nunca dado que el botón ya se ocultó, es solo defensivo.

### 3. `app/plataforma/soporte/page.tsx` — nueva sección + link en el nav de plataforma

- Switch activar/desactivar arriba (mismo componente visual que cualquier `<Switch>` ya usado en el proyecto, si existe uno reusable en `components/plataforma/`; si no, uno chico local a esta página).
- Tabla de reportes abajo, paginada — columnas: fecha, sede, quién reportó, descripción (truncada, expandible), captura (thumbnail/link si existe), estatus (`<select>` inline que dispara `cambiarEstatusReporteBug` al cambiar, sin modal — mismo criterio que "3 valores sin validación cruzada" del diseño). Filtro de estatus arriba de la tabla.

## Configuración nueva — variables de entorno

`App/backend/.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — requieren que el usuario cree un bot vía `@BotFather` en Telegram y obtenga su `chat_id` (documentado paso a paso en `docs/setup-backend-telegram.md` nuevo, mismo estilo que `docs/setup-backend-recordatorios-cron.md`). Sin estas 2 variables, `TelegramService` lanza al primer intento de envío — el reporte igual se guarda (best-effort), solo no llega el aviso.

## Fuera de alcance

- LLM/IA en el modo "Necesito ayuda" — queda como árbol de FAQ fijo.
- FAQ editable desde plataforma — cambiarla es un cambio de código normal, sin CRUD.
- Notificación de vuelta al reportante cuando cambia el estatus de su reporte.
- Más de una captura por reporte.
- El widget en `app/alumno/`.
- Toggles independientes para "ayuda" vs. "reporte de bugs" — un solo interruptor apaga todo.
- Historial/auditoría de quién cambió el estatus de un reporte más allá de lo que ya cubre `RegistroAuditoria` genérico.

## Verificación

- `nest build` + suite e2e nueva `soporte` (config GET/PATCH con y sin `PlatformAdminGuard`, crear reporte con/sin captura, `SOPORTE_DESACTIVADO` cuando `activo: false`, tipo de archivo inválido → 400, archivo >3MB → 400, listado cross-sede solo accesible por `PlatformAdminGuard`, cambio de estatus con valor inválido → 400, aislamiento — un reporte de una sede no se ve mezclado con el de otra en los campos que sí filtran por sede).
- `TelegramService` con `TELEGRAM_FETCH_OVERRIDE` en tests — mismo patrón que `MAIL_FETCH_OVERRIDE`, sin pegarle a la API real de Telegram en la suite.
- `pnpm build` + `pnpm lint` del frontend limpios.
- Verificación manual en navegador: abrir el bot desde admin y desde maestro, navegar el FAQ, mandar un reporte con y sin captura, confirmar que llega el mensaje a Telegram (con foto inline cuando aplica), verlo aparecer en `app/plataforma/soporte/`, cambiar su estatus, apagar el toggle y confirmar que el botón desaparece de admin/maestro y que `POST /soporte/reportes` directo (Postman) responde `SOPORTE_DESACTIVADO`.
