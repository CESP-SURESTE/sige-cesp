-- Fase 4, Día 12 — agrega el claim `primer_ingreso` al Auth Hook existente
-- (public.custom_access_token_hook, creado en la migración
-- 20260806224102_rls_multisede, Fase 1 Día 5; extendido con el claim `rol`
-- en 20260807191727_auth_hook_rol_claim, Fase 2 Día 8).
--
-- Mismo hook, mismo nombre/firma: `CREATE OR REPLACE FUNCTION` no rompe la
-- selección ya hecha en Supabase Dashboard -> Authentication -> Hooks.
--
-- Cambio: además de `sede_id` y `rol`, ahora también embebe `primer_ingreso`
-- (usuarios.primer_ingreso, boolean, default true en el schema — ver
-- `Usuario.primerIngreso` en prisma/schema.prisma). Lo consume el frontend
-- para forzar el flujo de "cambiar contraseña obligatorio" en el primer
-- login real de una cuenta dada de alta por un admin (Fase 4, Día 11:
-- `POST /personas` crea la cuenta con una contraseña temporal).
--
-- Mismo criterio de null-safety que sede_id/rol: si el usuario no tiene fila
-- en `usuarios`, el claim queda en `null`, no falla el login. No hace falta
-- ningún GRANT nuevo: `GRANT SELECT ON public.usuarios TO
-- supabase_auth_admin` (Día 5) ya es a nivel de tabla completa y cubre la
-- columna `primer_ingreso`.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  v_sede_id text;
  v_rol text;
  v_primer_ingreso boolean;
BEGIN
  -- Busca la sede, el rol y el flag de primer ingreso del usuario que está
  -- iniciando sesión. `usuarios.id` es el mismo UUID (guardado como TEXT,
  -- ver nota en current_sede_id() en la migración de Día 5) que Supabase
  -- Auth usa como `user_id` (regla 9 de CLAUDE.md).
  SELECT sede_id, rol::text, primer_ingreso
  INTO v_sede_id, v_rol, v_primer_ingreso
  FROM public.usuarios
  WHERE id = (event->>'user_id')::text;

  claims := COALESCE(event->'claims', '{}'::jsonb);

  IF v_sede_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{sede_id}', to_jsonb(v_sede_id));
  ELSE
    -- Usuario sin fila en `usuarios` (no debería pasar en producción, ya que
    -- toda cuenta de Supabase Auth se crea junto con su fila `usuarios` en la
    -- misma transacción — ver regla 9). Se deja el claim en null en vez de
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

  IF v_primer_ingreso IS NOT NULL THEN
    claims := jsonb_set(claims, '{primer_ingreso}', to_jsonb(v_primer_ingreso));
  ELSE
    -- Mismo criterio que sede_id/rol: sin fila en `usuarios`, se deja el
    -- claim en null en vez de fallar el login por completo.
    claims := jsonb_set(claims, '{primer_ingreso}', 'null');
  END IF;

  event := jsonb_set(event, '{claims}', claims);

  RETURN event;
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Auth Hook de Supabase (Custom Access Token Hook) — embebe los claims '
  'sede_id (usuarios.sede_id), rol (usuarios.rol) y primer_ingreso '
  '(usuarios.primer_ingreso) en el JWT. Requiere activarse manualmente en '
  'Dashboard -> Authentication -> Hooks (Fase 1, Día 5; claim rol agregado '
  'en Fase 2, Día 8; claim primer_ingreso agregado en Fase 4, Día 12).';
