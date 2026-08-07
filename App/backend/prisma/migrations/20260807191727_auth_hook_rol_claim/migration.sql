-- Fase 2, Día 8 — agrega el claim `rol` al Auth Hook existente
-- (public.custom_access_token_hook, creado en la migración
-- 20260806224102_rls_multisede, Fase 1 Día 5).
--
-- Mismo hook, mismo nombre/firma: `CREATE OR REPLACE FUNCTION` no rompe la
-- selección ya hecha en Supabase Dashboard -> Authentication -> Hooks (si el
-- hook ya fue activado, sigue apuntando a esta misma función; si no fue
-- activado todavía, sigue pendiente el mismo paso manual, ver comentario
-- original en la migración de Día 5).
--
-- Cambio: además de `sede_id`, ahora también embebe `rol` (Usuario.rol,
-- columna `rol` en `usuarios`, enum RolUsuario: ALUMNO | MAESTRO |
-- ADMINISTRATIVO — sin remapeo de nombre, mismo nombre en DB). Esto NO es
-- `PerfilAdministrativo.nivelPermiso` (SUPER_ADMIN/ADMIN/AUXILIAR), que sigue
-- fuera de alcance.
--
-- No hace falta ningún GRANT nuevo: `GRANT SELECT ON public.usuarios TO
-- supabase_auth_admin` (Día 5) ya es a nivel de tabla completa y cubre la
-- columna `rol`.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  v_sede_id text;
  v_rol text;
BEGIN
  -- Busca la sede y el rol del usuario que está iniciando sesión.
  -- `usuarios.id` es el mismo UUID (guardado como TEXT, ver nota en
  -- current_sede_id() en la migración de Día 5) que Supabase Auth usa como
  -- `user_id` (regla 5.9 de CLAUDE.md). `rol` es un enum (RolUsuario) — se
  -- castea a text explícitamente para poder embeberlo como string en el JWT.
  SELECT sede_id, rol::text INTO v_sede_id, v_rol
  FROM public.usuarios
  WHERE id = (event->>'user_id')::text;

  claims := COALESCE(event->'claims', '{}'::jsonb);

  IF v_sede_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{sede_id}', to_jsonb(v_sede_id));
  ELSE
    -- Usuario sin fila en `usuarios` (no debería pasar en producción, ya que
    -- toda cuenta de Supabase Auth se crea junto con su fila `usuarios` en la
    -- misma transacción — ver regla 5.9). Se deja el claim en null en vez de
    -- fallar el login por completo.
    claims := jsonb_set(claims, '{sede_id}', 'null');
  END IF;

  IF v_rol IS NOT NULL THEN
    claims := jsonb_set(claims, '{rol}', to_jsonb(v_rol));
  ELSE
    -- Mismo criterio que sede_id: sin fila en `usuarios`, se deja el claim
    -- en null en vez de fallar el login por completo.
    claims := jsonb_set(claims, '{rol}', 'null');
  END IF;

  event := jsonb_set(event, '{claims}', claims);

  RETURN event;
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Auth Hook de Supabase (Custom Access Token Hook) — embebe los claims '
  'sede_id (usuarios.sede_id) y rol (usuarios.rol) en el JWT. Requiere '
  'activarse manualmente en Dashboard -> Authentication -> Hooks (Fase 1, '
  'Día 5; claim rol agregado en Fase 2, Día 8).';
