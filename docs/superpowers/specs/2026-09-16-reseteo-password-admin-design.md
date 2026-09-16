# Reseteo de contraseña disparado por administrativo

**Fecha:** 2026-09-16
**Estado:** aprobado, pendiente de implementación
**Alcance:** solo los 3 roles con cuenta Supabase Auth (ALUMNO/MAESTRO/ADMINISTRATIVO). `/plataforma` (AdminPlataforma) queda fuera — decisión explícita del usuario.

## Motivación

No existe ningún mecanismo de recuperación de contraseña hoy — solo `PATCH /auth/cambiar-password` (requiere conocer la contraseña actual). Decisión del usuario tras brainstorming: **sin autoservicio**. La persona que olvidó su contraseña acude en persona con un administrativo, que dispara el reseteo desde el CRUD de personas.

## Decisiones de diseño (del brainstorming)

- Sin formulario público de "olvidé mi contraseña". Solo un ADMINISTRATIVO, desde el listado de alumnos/maestros/administrativos, puede disparar un reseteo para una persona puntual.
- El reseteo se completa vía **correo con link** (no un código de 6 dígitos, no una contraseña temporal mostrada en pantalla).
- Cooldown de 1 hora, **por par (administrativo actor, persona objetivo)**, implementado **solo en el frontend** (deshabilitar el botón) — sin enforcement en el backend. Dos admins distintos pueden resetear a la misma persona sin bloquearse entre sí; el mismo admin puede resetear a otra persona sin esperar.

## Mecanismo técnico — reuso de Supabase Auth, sin tabla propia

En vez de construir una tabla de tokens con hash/expiración a mano, se usa `client.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })` — la misma Admin API (`SupabaseAdminClient`) que ya usan `AuthService`/`PersonasService`. Esta llamada **genera** el link pero **no lo envía** — lo enviamos nosotros por Mailgun a `correoPersonal` (el único correo real de la persona, nunca `Usuario.email`, que es sintético desde 2026-08-18). Sin migración de tabla nueva, sin criptografía propia.

Cuando la persona abre el link, Supabase redirige el navegador a `redirectTo` con una sesión de recuperación ya establecida (el cliente de Supabase-JS del frontend, creado con `createBrowserClient`, la detecta automáticamente en la URL — mismo mecanismo de siempre, sin código adicional). Ahí, el navegador llama `supabase.auth.updateUser({ password })` directamente — sin backend de por medio para el cambio de contraseña real.

## Backend

### 1. Migración: `AccionAuditoria` gana `RESETEO_PASSWORD`

Aislada, mismo patrón que `20260908120000_accion_auditoria_consulta_emergencia` — solo `ALTER TYPE ... ADD VALUE` (Postgres no permite usar un valor de enum nuevo en la misma transacción que lo crea).

### 2. `MailService` — nuevo método `enviarCorreoReseteoPassword`

Mismo patrón que `enviarCorreoBienvenida` (builders `buildTexto`/`buildHtml` privados, mismo `enviarCorreoAMailgun` interno, mismo respeto de `MAILGUN_ENVIOS_HABILITADO`). Firma:

```ts
export interface EnviarCorreoReseteoPasswordParams {
  nombreCompleto: string;
  correoDestino: string;
  linkReseteo: string;
}

async enviarCorreoReseteoPassword(
  params: EnviarCorreoReseteoPasswordParams,
): Promise<void>
```

Texto: explica que un administrativo solicitó el reseteo, incluye el link, aclara que si la persona no lo solicitó puede ignorar el correo.

**Diferencia clave con `enviarCorreoBienvenida`:** el caller (`PersonasService.resetearPassword`) NO envuelve esta llamada en un try/catch silencioso — si Mailgun falla, la excepción se propaga y el endpoint responde `500 SERVER_ERROR`. A diferencia del correo de bienvenida (donde la cuenta ya es usable vía la contraseña temporal mostrada en pantalla, así que el correo es un "plus" best-effort), aquí el correo ES el único mecanismo de entrega — un fallo silencioso dejaría al admin creyendo que se envió algo que nunca llegó.

### 3. `PersonasService.resetearPassword(id, sedeId, actorUsuarioId)`

Nuevo método, mismo archivo/clase que `cambiarEstatus` (reusa `this.getClient()`, `this.mailService`, `PersonasService.JERARQUIA_NIVEL_PERMISO`, el mismo `try/catch` de mapeo de errores).

1. `findFirst({ where: { id, sedeId } })` con `select` de `email`, `rol`, `perfilAdministrativo.nivelPermiso`, y los 3 nombres (`nombres`/`apellidoPaterno`/`apellidoMaterno` del perfil correspondiente al rol) — igual que `cambiarEstatus` selecciona el perfil condicional al rol. `id` no encontrado en la sede → `404 NOT_FOUND` ("Persona no encontrada en tu sede").
2. Si `usuario.rol === ADMINISTRATIVO`: aplicar la MISMA jerarquía de `nivelPermiso` que `cambiarEstatus` (un `AUXILIAR` no puede resetear a ningún administrativo; nadie puede resetear a alguien con `nivelPermiso` mayor al propio) → `403 NIVEL_PERMISO_INSUFICIENTE` si falla. Para `ALUMNO`/`MAESTRO` no aplica ningún chequeo de jerarquía.
3. Resolver `correoPersonal` con el helper YA EXISTENTE `obtenerCorreosPersonales(prisma, [id])` (`src/common/publicacion/correos-destinatarios.util.ts`) — si viene vacío (no debería pasar para estos 3 roles), `500 SERVER_ERROR` logueado (defensivo).
4. `client.auth.admin.generateLink({ type: 'recovery', email: usuario.email, options: { redirectTo: \`${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/restablecer-password\` } })`. Si Supabase devuelve error, `500 SERVER_ERROR` (logueado, regla 12).
5. `this.mailService.enviarCorreoReseteoPassword({ nombreCompleto, correoDestino: correoPersonal, linkReseteo: data.properties.action_link })` — **AWAIT directo, sin try/catch que trague el error** (ver sección MailService arriba). Si lanza, se re-mapea a `500 SERVER_ERROR` en el catch general del método (mismo patrón que el resto del archivo).
6. `RegistroAuditoria` — SIN transacción con lo anterior (no hay nada que compensar: el link ya se generó y el correo ya se envió antes de este punto; si el audit falla, se loguea completo y no se revierte nada, mismo criterio que el fallback de `cambiarPassword` cuando el update secundario falla después de que la contraseña ya cambió en Supabase Auth):
   ```ts
   accion: AccionAuditoria.RESETEO_PASSWORD,
   entidad: 'Usuario',
   entidadId: id,
   detalle: { rol: usuario.rol }, // NUNCA el link ni ningún dato sensible
   ```
7. Retorna `{ ok: true }`.

### 4. `PersonasController` — `POST /personas/:id/resetear-password`

Mismos guards que el resto (`@Roles(RolUsuario.ADMINISTRATIVO)`, clase ya tiene `@UseGuards(SedeGuard, RolesGuard)`), mismo patrón que `cambiarEstatus`:

```ts
@Post(':id/resetear-password')
@Roles(RolUsuario.ADMINISTRATIVO)
async resetearPassword(
  @Param('id') id: string,
  @SedeActual() sedeId: string,
  @ActorUsuarioId() actorUsuarioId: string,
) {
  const data = await this.personasService.resetearPassword(id, sedeId, actorUsuarioId);
  return { data };
}
```

Sin DTO de body (no recibe nada del cliente más que el `:id`).

### 5. `AuthService.completarReseteo(actorUsuarioId, sedeId)`

Nuevo método en `AuthService`, junto a `cambiarPassword`. Se llama DESPUÉS de que el navegador ya cambió la contraseña real vía `supabase.auth.updateUser()` (client-side, sin este backend de por medio) — este método solo:

1. `usuario.update({ where: { id: actorUsuarioId }, data: { primerIngreso: false } })`.
2. `RegistroAuditoria` con `accion: AccionAuditoria.EDICION` (mismo criterio que `cambiarPassword` — no hay valor de enum dedicado a "completar reseteo", y semánticamente es una edición de la propia fila `Usuario`), `detalle: { accion: 'completar_reseteo_password' }`.
3. Sin transacción con nada más (no hay nada previo que compensar en este método). Si falla, se loguea completo (regla 12) pero SÍ se responde éxito igual — la contraseña ya es la correcta en Supabase Auth en este punto, no hay nada que revertir (mismo criterio que el paso c/d de `cambiarPassword`).
4. Retorna `{ ok: true }`.

### 6. `AuthController` — `POST /auth/completar-reseteo`

Mismos guards que `cambiarPassword` (`@UseGuards(SedeGuard)` únicamente, sin `RolesGuard` — cualquier rol autenticado):

```ts
@Post('completar-reseteo')
@HttpCode(200)
@UseGuards(SedeGuard)
async completarReseteo(
  @ActorUsuarioId() actorUsuarioId: string,
  @SedeActual() sedeId: string,
) {
  const data = await this.authService.completarReseteo(actorUsuarioId, sedeId);
  return { data };
}
```

Sin body.

## Frontend

### 1. `lib/api/personas.ts` — `resetearPasswordPersona(usuarioId: string): Promise<{ ok: true }>`

Mismo patrón que `cambiarEstatusPersona`:

```ts
export function resetearPasswordPersona(usuarioId: string): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>(`/personas/${usuarioId}/resetear-password`, {
    method: 'POST',
  });
}
```

### 2. `lib/api/auth.ts` — `completarReseteo(): Promise<{ ok: true }>`

```ts
export function completarReseteo(): Promise<{ ok: true }> {
  return apiFetchAuth<{ ok: true }>('/auth/completar-reseteo', { method: 'POST' });
}
```

### 3. Modal compartido nuevo: `components/admin/ui/personas-listado/ResetearPasswordModal.tsx`

Mismo patrón visual que `CambiarEstatusModal.tsx` (overlay + panel `max-w-md`, botón azul de acción — no es un borrado). Contenido: confirmación simple, SIN mostrar el correo destino real (evita exponer PII en un modal de confirmación; el listado tampoco trae `correoPersonal` hoy y no se extiende el contrato solo para esto):

```
"¿Restablecer la contraseña de {nombreCompleto}? Se enviará un enlace a su correo personal registrado."
[Cancelar] [Enviar enlace]
```

Props: `{ nombreCompleto: string; enviando: boolean; onConfirmar: () => void; onCancelar: () => void }`.

### 4. Cooldown — hook nuevo `components/admin/ui/personas-listado/useCooldownReseteo.ts`

Por par `(actorUsuarioId, targetUsuarioId)`, persistido en `localStorage` (clave `sige:reseteo-cooldown:{actorUsuarioId}:{targetUsuarioId}`, valor = timestamp de expiración). Expone `{ estaEnCooldown(targetUsuarioId): boolean, minutosRestantes(targetUsuarioId): number, iniciarCooldown(targetUsuarioId): void }`. `actorUsuarioId` se resuelve una vez adentro del hook desde el mismo `queryKey: ['admin', 'perfil']` que ya usa `app/admin/administrativos/page.tsx` (evita otro fetch). 1 hora = `60 * 60 * 1000` ms.

### 5. Integración en los 3 listados

- `app/admin/administrativos/page.tsx` y `app/admin/maestros/page.tsx`: ya tienen columna "Acciones" con "Cambiar estatus" — se agrega un segundo botón "Restablecer contraseña" junto al existente, mismo `useMutation`+`toast` pattern, deshabilitado si `estaEnCooldown(persona.usuarioId)` (con el texto "Disponible en Nh" o similar).
- `app/admin/alumnos/page.tsx`: HOY NO TIENE columna "Acciones" — se agrega una nueva (mismo header `<Th>Acciones</Th>` que los otros 2 listados), con únicamente el botón de "Restablecer contraseña" (alumno no tiene "Cambiar estatus" desde su listado, fuera de alcance de este cambio, no se agrega aquí).
- Éxito → `toast.success('Enlace enviado')` + `iniciarCooldown(usuarioId)`. Error → `toast.error(...)` (regla 12: loguear con `console.error` antes del toast, mismo patrón que el resto de estas páginas) — SIN iniciar cooldown.

### 6. Página pública nueva: `app/restablecer-password/page.tsx`

Client component, sin layout de admin/alumno/maestro (vive en la raíz de `app/`, mismo nivel que `app/login/`). Flujo:

1. Al montar, usa el cliente de `createClient()` (`lib/supabase/client.ts`) y escucha `onAuthStateChange` (o revisa `getSession()` tras un pequeño delay) para confirmar que la sesión de recuperación quedó establecida. Mientras tanto, muestra un estado de carga.
2. Si no hay sesión después de la verificación (link inválido/expirado — Supabase agrega `error_description` en la URL en ese caso), muestra un mensaje de error: "Este enlace no es válido o ya expiró. Pide a un administrativo que genere uno nuevo." — sin formulario.
3. Si hay sesión, muestra un form con "Nueva contraseña" + "Confirmar contraseña" (mismo mínimo de 8 caracteres que `cambiarPassword`/`CambiarPasswordDto`; validación de que ambos campos coincidan, client-side).
4. Al enviar: `supabase.auth.updateUser({ password })`. Si falla, `toast.error` + loguear (regla 12). Si tiene éxito: `completarReseteo()` (best-effort — si falla, solo se loguea, NO se bloquea al usuario, la contraseña ya quedó bien puesta) → `router.push('/')` + `router.refresh()` (mismo patrón exacto que `app/login/page.tsx` al terminar login exitoso — deja que `proxy.ts` decida el home por rol).

### 7. `src/proxy.ts` — nueva ruta pública

Agregar `'/restablecer-password'` al array `RUTAS_PUBLICAS`. A diferencia de `/login`, NO necesita el caso especial de "si ya autenticado, redirigir" (esa rama del `if` solo aplica `pathname === '/login'`) — con solo agregarlo al array, la ruta cae al `return supabaseResponse` genérico y se renderiza sin importar el estado de auth, que es exactamente lo que se necesita (la sesión de recuperación SÍ cuenta como "autenticada" para los claims del JWT).

## Configuración manual requerida (fuera de este código)

- **Supabase Dashboard → Auth → URL Configuration → Redirect URLs**: agregar `{FRONTEND_URL}/restablecer-password` para dev y para prod. Sin esto, Supabase rechaza el `redirectTo` del link y el flujo no funciona. Esto lo hace el usuario, no es código.
- **Mailgun sigue en sandbox**: hoy solo entrega a `jesusaviala@gmail.com` (limitación ya documentada en `CLAUDE.md`, no nueva). La prueba end-to-end completa de este flujo depende de esa cuenta hasta que CESP tenga su dominio real configurado.

## Fuera de alcance

- `/plataforma` (AdminPlataforma) — decisión explícita del usuario.
- Autoservicio ("olvidé mi contraseña" público) — decisión explícita del usuario.
- Enforcement de cooldown en backend — decisión explícita del usuario ("es solo hacer disabled en botón").
- Exponer `correoPersonal` en el listado de personas o en el modal de confirmación.
- Configurar el "Email OTP expiry" de Supabase (gobierna cuánto dura el link) — se deja el default del proyecto de Supabase; si se quiere ajustar, es config de dashboard, no código.

## Verificación

- `nest build` + suite e2e del backend en verde (agregar casos para `resetear-password`: 404 fuera de sede, 403 jerarquía nivelPermiso, 200 éxito con `MAILGUN_ENVIOS_HABILITADO=false`; y para `completar-reseteo`: 200 éxito, verificar `primerIngreso: false`).
- `pnpm build` + `pnpm lint` del frontend limpios.
- Verificación manual: con `MAILGUN_ENVIOS_HABILITADO=true` y el destinatario autorizado del sandbox (`jesusaviala@gmail.com` en un perfil de prueba), disparar el reseteo desde el listado de administrativos, abrir el correo real, completar el flujo en `/restablecer-password`, confirmar login con la contraseña nueva.
