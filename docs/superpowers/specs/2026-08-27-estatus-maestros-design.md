# Diseño — Cambio de estatus para MAESTRO (paridad con ADMINISTRATIVO)

**Fecha:** 2026-08-27
**Fase:** 9/10 (sin día de roadmap asignado — pedido explícito del usuario tras
la verificación en navegador de los ajustes de estatus avanzado)
**Estado:** aprobado en brainstorming, pendiente de plan

## Contexto

El 2026-08-26 se construyó "estatus avanzado" para ADMINISTRATIVO: badge de
color (`EstatusEmpleadoBadge`), modal de cambio de estatus con selects
condicionales (`tipoLicencia` si `LICENCIA`, `motivoBaja` si `BAJA`, con aviso
inline cuando el motivo revoca acceso), y `calcularActivoPorEstatus` que apaga
`Usuario.activo` solo para `motivoBaja` `RENUNCIA`/`DESPIDO`.

El backend de `PATCH /personas/:id/estatus` **ya es simétrico para MAESTRO** —
`PerfilMaestro` tiene los campos `tipoLicencia`/`motivoBaja` desde la migración
`20260826172714_estatus_avanzado_administrativo`, y `calcularActivoPorEstatus`
no distingue rol (solo excluye `ALUMNO`, que usa `EstatusAcademico`). Lo que
falta es:

1. **Frontend:** `app/admin/maestros/page.tsx` es solo lectura (Día 19) — estatus
   en texto plano, sin columna de acciones.
2. **Backend (mínimo):** `GET /personas?rol=MAESTRO` no devuelve `tipoLicencia`
   (necesario para el tooltip del badge, igual que se agregó a ADMINISTRATIVO).
3. **Tests:** `personas-estatus.e2e-spec.ts` dice cubrir "mismos casos para
   MAESTRO" pero **no es cierto** — todos los casos del path avanzado
   (licencia/motivo/revocación) usan target `ADMINISTRATIVO`. El path MAESTRO
   está sin probar.

## Alcance

Paridad completa de la UI de estatus entre maestros y administrativos:
- Badge de color con tooltip de motivo de licencia.
- Columna "Acciones" con botón "Cambiar estatus" → modal con selects
  condicionales de `tipoLicencia`/`motivoBaja` y aviso de revocación.
- Cobertura e2e del path MAESTRO en backend.

### Fuera de alcance (deliberado)

- Dedup del mapa `TIPO_LICENCIA_LABEL` entre `EstatusEmpleadoBadge.tsx` y el
  modal (dup deliberada ya documentada — 9 valores, sin tercer consumidor).
- UI de cambio de estatus para ALUMNO (`EstatusAcademico` no tiene el concepto
  de licencia/motivo de baja).
- Mostrar `motivoBaja` en la tabla (administrativos tampoco lo hace — vive en
  el modal y en `RegistroAuditoria.detalle`).
- Jerarquía de `nivelPermiso` sobre el target MAESTRO: no aplica
  (`nivelPermiso` es exclusivo de `PerfilAdministrativo`; el backend ya no
  corre ese chequeo para target no-ADMINISTRATIVO). Cualquier `ADMINISTRATIVO`
  puede cambiar el estatus de cualquier maestro.

## Diseño

### 1. Backend

**`PersonasService.listarPorSedeYRol`** (`personas.service.ts`) — rama
`rol === 'MAESTRO'`:
- Agregar `tipoLicencia: true` al `select` del `PerfilMaestro`.
- Incluir `tipoLicencia` en el objeto mapeado del resultado.

**Interfaz `PersonaListItemMaestro`** (backend, `personas.service.ts`):
```ts
tipoLicencia: TipoLicencia | null;
```
Mismo comentario que la de ADMINISTRATIVO: solo tiene valor si
`estatus === 'LICENCIA'` actual; `null` en cualquier otro estatus (incluido el
rastro histórico de una licencia pasada — el frontend solo lo muestra cuando el
estatus actual es LICENCIA).

**Espejo frontend** — `PersonaListItemMaestro` en `App/frontend/src/lib/api/personas.ts`:
mismo campo `tipoLicencia: TipoLicencia | null` (el tipo `TipoLicencia` ya está
exportado en ese archivo).

**Sin cambios** en `PATCH /personas/:id/estatus`, DTO, schema ni migración —
todo eso ya es simétrico para MAESTRO.

### 2. Modal compartido

El `CambiarEstatusModal` actual (`app/admin/administrativos/CambiarEstatusModal.tsx`)
**ya es genérico** salvo por el tipo de su prop (`administrativo:
PersonaListItemAdministrativo`) — internamente solo lee `.estatus`, `.nombres`,
`.apellidoPaterno`, `.apellidoMaterno`. Toda la lógica de jerarquía
(`JERARQUIA_NIVEL_PERMISO`, ocultar botón en la fila del actor) vive en la
**página**, no en el modal.

Cambios:
- **Mover** `app/admin/administrativos/CambiarEstatusModal.tsx` →
  `components/admin/ui/personas-listado/CambiarEstatusModal.tsx` (misma carpeta
  que `EstatusEmpleadoBadge`, ya compartido entre listados).
- **Generalizar el prop:** de `administrativo: PersonaListItemAdministrativo` a
  ```ts
  persona: {
    estatus: EstatusEmpleado;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
  };
  ```
  Renombrar los usos internos `administrativo.` → `persona.`. El texto
  "administrativo" en el JSDoc y en el `<p>` ("Cambia el estatus de …") se
  vuelve neutro ("de esta persona").
- Los mapas `TIPO_LICENCIA_LABEL` / `MOTIVO_BAJA_LABEL` / `ESTATUS_EMPLEADO_LABEL`
  se quedan dentro del modal (una sola fuente para ambos consumidores).
- **Actualizar el import** en `app/admin/administrativos/page.tsx` a la ruta
  nueva; pasar `persona={administrativo}` en vez de `administrativo={administrativo}`.

No se agrega prop `conJerarquia` — el modal nunca supo de jerarquía.

### 3. Frontend `app/admin/maestros/page.tsx`

Calco del patrón de `administrativos/page.tsx`, sin la parte de jerarquía:

- **Imports:** `useMutation`, `useQueryClient` de react-query;
  `cambiarEstatusPersona` de `lib/api/personas`; `EstatusEmpleadoBadge` y
  `CambiarEstatusModal` de `components/admin/ui/personas-listado/`.
- **Celda de estatus:** `{ESTATUS_EMPLEADO_LABEL[maestro.estatus]}` →
  `<EstatusEmpleadoBadge estatus={maestro.estatus} tipoLicencia={maestro.tipoLicencia} />`.
  El const local `ESTATUS_EMPLEADO_LABEL` se conserva — lo sigue usando
  `ESTATUS_EMPLEADO_OPTIONS` para el filtro del buscador.
- **Columna nueva "Acciones"** (última): botón "Cambiar estatus" por fila.
  Sin guardia de fila propia (un `ADMINISTRATIVO` nunca es un `MAESTRO`), sin
  guardia de jerarquía.
- **Estado:** `const [maestroEnEdicion, setMaestroEnEdicion] = useState<PersonaListItemMaestro | null>(null)`.
- **Mutación:**
  ```ts
  const cambiarEstatusMutation = useMutation({
    mutationFn: (vars: {
      usuarioId: string;
      estatus: EstatusEmpleado;
      extra: { tipoLicencia?: TipoLicencia; motivoBaja?: MotivoBaja };
    }) => cambiarEstatusPersona(vars.usuarioId, vars.estatus, vars.extra),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'personas', 'MAESTRO'],
      });
      setMaestroEnEdicion(null);
    },
  });
  ```
  Manejo de error: mostrar el mensaje del backend (mismo criterio que
  administrativos — revisar cómo lo hace esa página y replicar; probablemente un
  `<p>` de error dentro o cerca del modal). Loguear el error en el `onError`
  (regla 12).
- **Render del modal** cuando `maestroEnEdicion !== null`:
  ```tsx
  <CambiarEstatusModal
    persona={maestroEnEdicion}
    guardando={cambiarEstatusMutation.isPending}
    onGuardar={(estatus, extra) =>
      cambiarEstatusMutation.mutate({
        usuarioId: maestroEnEdicion.usuarioId,
        estatus,
        extra,
      })
    }
    onCancelar={() => setMaestroEnEdicion(null)}
  />
  ```
- El prop `maestros` de `TablaMaestros` pasa a necesitar los callbacks
  (`onCambiarEstatus`) o se sube el estado — seguir el patrón exacto de
  `TablaAdministrativos`.

### 4. Tests

**`personas-listado.e2e-spec.ts`** — bloque `rol=MAESTRO`: agregar
`'tipoLicencia'` al array de llaves esperadas del shape de `PersonaListItemMaestro`
(mismo cambio que ya se hizo para ADMINISTRATIVO).

**`personas-estatus.e2e-spec.ts`** — agregar fixture de target MAESTRO y casos
del path avanzado con ese target:
- `LICENCIA` sin `tipoLicencia` → 400 `VALIDATION_ERROR`.
- `LICENCIA` con `tipoLicencia` válido → 200, `Usuario.activo` sigue `true`,
  `RegistroAuditoria.detalle.cuentaRevocada === false`.
- `BAJA` con `motivoBaja: 'RENUNCIA'` → 200, `Usuario.activo === false`,
  `cuentaRevocada === true`.
- `BAJA` con `motivoBaja: 'BAJA_TEMPORAL_SALUD'` → 200, `Usuario.activo === true`,
  `cuentaRevocada === false`.
- Reingreso vía `ACTIVO` → 200, `Usuario.activo === true`; `motivoBaja` previo
  NO se limpia (rastro histórico).

**Frontend:** `tsc --noEmit` limpio + `pnpm build`. Sin test de componente
(mismo criterio que el modal de administrativos — no hay infra de test de
componentes en el proyecto).

### 5. Docs

**`CLAUDE.md`:**
- Shape de MAESTRO en `GET /personas`: agregar `tipoLicencia` a la lista de
  campos y una nota (paralela a la de ADMINISTRATIVO) de que solo tiene valor
  con `estatus === 'LICENCIA'` actual.
- Quitar / matizar el "MAESTRO no lo trae porque no tiene UI de cambio de
  estatus todavía (Día 19)" — ya la tiene.
- En `PATCH /personas/:id/estatus`: notar que la UI de MAESTRO
  (`app/admin/maestros/page.tsx`) ya consume el path avanzado, no solo
  administrativos.
- Regla 13 / estado de implementación: `CambiarEstatusModal` promovido a
  `components/admin/ui/personas-listado/` (compartido entre los dos listados,
  mismo criterio que `EstatusEmpleadoBadge`).

**`documentacion_de_agentes/ESTADO.md`:** entrada nueva describiendo el cambio,
el hallazgo del gap de cobertura e2e, y los archivos tocados.

## Orden de implementación sugerido

1. Backend: `tipoLicencia` en el listado MAESTRO (interfaz + service + espejo
   frontend) + extender `personas-listado.e2e-spec.ts`.
2. Mover y generalizar `CambiarEstatusModal` + actualizar `administrativos/page.tsx`
   (verificar que administrativos sigue igual: `tsc`, build, e2e sin tocar).
3. Frontend maestros: badge + columna Acciones + modal + mutación.
4. Extender `personas-estatus.e2e-spec.ts` con el fixture y los casos MAESTRO.
5. Docs (`CLAUDE.md` + `ESTADO.md`).
6. Verificación: `tsc --noEmit` (front + back), `pnpm build` frontend, suite e2e
   completa vía `node scripts/run-e2e.js`.
