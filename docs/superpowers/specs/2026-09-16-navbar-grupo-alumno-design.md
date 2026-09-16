# Grupo en el navbar del alumno

**Fecha:** 2026-09-16
**Estado:** aprobado, pendiente de implementación
**Alcance:** solo árbol `app/alumno/`. Maestro queda fuera a propósito (no encaja el mismo concepto — un maestro no "pertenece" a un grupo, da clase en varios).

## Motivación

Idea diferida desde 2026-09-02 ([[sige-navbar-grupo-idea]]): mostrar en el navbar el grupo al que pertenece el alumno logueado. El backend ya existe (`GET /perfil/grupo/companeros`, Fase 11 Día 32) — este trabajo es 100% frontend.

## Diseño

**Componente afectado:** `App/frontend/src/components/alumno/ui/shell/SedeCarreraBadge.tsx`. Se extiende (no se crea un componente nuevo) agregando un tercer badge al final de la fila existente: **sede → carrera → grupo**.

**Fetch de datos:** nuevo `useQuery` dentro del mismo componente:
- `queryKey: ['alumno', 'companeros']` — mismo key que ya usa el bloque comentado `SeccionCompaneros` en `app/alumno/page.tsx` (oculto desde 2026-09-07, ver CLAUDE.md raíz). Se reutiliza a propósito: si esa sección se reactiva en el futuro, comparte caché sin duplicar el fetch.
- `queryFn`: llama a `obtenerCompaneros()` (ya existe en `lib/api/perfil.ts`, pega a `GET /perfil/grupo/companeros`). Mismo patrón de logging que el resto del componente: `console.error` + re-throw en el catch (regla 12 de CLAUDE.md raíz).

**Selección del grupo a mostrar:** el endpoint devuelve `GrupoConCompaneros[]` ordenado `anioInicio desc, cicloActual desc, nombre asc` (ya así en el backend). Se toma `data[0]` — el más reciente. Un alumno en 2+ grupos simultáneos es un caso raro (Día 30 lo permite pero no es el flujo normal); no se complica la UI por él.

**Render condicional:** si el array viene vacío (alumno sin grupo) o la query aún no resolvió / falló, el badge de grupo simplemente no se renderiza — mismo criterio ya establecido en este componente para `perfil` (`if (!perfil) return null`) y para `perfil.alumno` (badge de carrera condicional). Sin loading state visible, sin toast de error — es dato secundario de contexto, no una sección crítica.

**Texto del badge:** `"{grupo.nombre} · Cuatrimestre {grupo.cicloActual}"`. Reutiliza el formato `"Cuatrimestre N"` ya establecido (ej. `formatearPeriodo` en `app/admin/grupos/page.tsx`), sin año — descartado explícitamente por el usuario en brainstorming.

**Icono:** `IconGrupo` nuevo en `components/alumno/ui/shell/icons.tsx` (dos personas, mismo estilo SVG inline `BASE` que los demás iconos del archivo). No se importa de `admin` — regla 11 de CLAUDE.md raíz (sin componentes compartidos entre árboles).

**Estilo del badge:** mismo patrón visual que los badges de sede/carrera existentes (`rounded-full bg-mist/50 px-3 py-1.5 text-xs font-medium text-slate`), oculto en breakpoints chicos igual que el de carrera (`hidden ... md:flex`) para no saturar el navbar en móvil.

## Fuera de alcance

- Maestro (decisión explícita del usuario en brainstorming).
- Selector/dropdown para elegir entre grupos si el alumno tiene varios — se muestra solo el primero.
- Reactivar `SeccionCompaneros` en `app/alumno/page.tsx` — sigue oculta, sin tocar.
- Cambios al backend — `GET /perfil/grupo/companeros` no se modifica.

## Verificación

- `pnpm build` + `pnpm lint` del frontend limpios.
- Verificación manual en navegador: alumno con grupo ve el badge nuevo; si existe un alumno de prueba sin grupo (o se puede simular), confirmar que no rompe el layout ni muestra un badge vacío.
