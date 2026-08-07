-- ============================================================================
-- Fase 1 — Multi-sede — Día 5: RLS policies por sede_id
-- ============================================================================
--
-- CONTEXTO IMPORTANTE — quién queda sujeto a esto y quién no
-- ----------------------------------------------------------
-- El backend de NestJS (Prisma) se conecta a Supabase con el rol `postgres`
-- (vía el connection pooler). Igual que `service_role`, ese rol tiene
-- `rolbypassrls = true` — es decir, TODA esta RLS es transparente/invisible
-- para el propio backend. Esto es intencional y coincide con la regla 5.2 de
-- CLAUDE.md ("ninguna de las dos capas reemplaza a la otra"):
--
--   - El GUARD de NestJS (Día 6) es la capa que de verdad filtra las queries
--     del día a día de la aplicación — el backend arma cada `WHERE sede_id = ...`
--     usando el `sede_id` que vino del JWT.
--   - Esta RLS es la última línea de defensa a nivel de fila en Postgres:
--     protege contra cualquier otro camino de acceso que NO pase por el guard
--     de NestJS — Data API de Supabase si algún día se reactiva por error,
--     Supabase Studio con un rol no-admin, Realtime, o cualquier conexión
--     futura que use el rol `authenticated`/`anon` en vez de `postgres`.
--
-- Se prueba manualmente "impersonando" al rol `authenticated` con
-- `SET LOCAL ROLE` — ver documentacion_de_agentes/bitacoras/backend/historial/ para la
-- evidencia real de una corrida de esta prueba.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Función helper: sede_id del JWT actual
-- ----------------------------------------------------------------------------
-- `auth.jwt()` es un helper estándar de Supabase que expone los claims del
-- JWT de la request actual como jsonb (vía el GUC `request.jwt.claims`, que
-- en producción llena PostgREST/Supabase automáticamente a partir del
-- Authorization header, y que en Fase 2 llenará también nuestro Auth Hook
-- con el custom claim `sede_id` — ver sección 3 de este archivo).
--
-- NULLIF: si el claim no existe o viene vacío, regresa NULL en vez de una
-- cadena vacía — así ninguna policy matchea por accidente (comportamiento
-- "cerrado por default", correcto).
--
-- Regresa `text`, no `uuid`: aunque los IDs son UUIDs válidos, Prisma los
-- mapea como columnas `TEXT` (`String @id @default(uuid())`), no como el
-- tipo nativo `uuid` de Postgres — ver `migration.sql` de
-- `20260805204943_init_modelo_completo`. Comparar `text = uuid` no tiene
-- operador implícito en Postgres (por eso la primera corrida de esta
-- migración falló con `operator does not exist: text = uuid`); manteniendo
-- todo en `text` evita el cast y respeta el tipo real de columna.
CREATE OR REPLACE FUNCTION public.current_sede_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'sede_id', '');
$$;

COMMENT ON FUNCTION public.current_sede_id() IS
  'Extrae el custom claim sede_id del JWT de la request actual (auth.jwt()). '
  'NULL si no hay JWT o el claim no viene. Usado por todas las RLS policies '
  'de aislamiento multi-sede (Fase 1, Día 5).';

-- ----------------------------------------------------------------------------
-- 2) Habilitar RLS + policies, tabla por tabla
-- ----------------------------------------------------------------------------
-- Convención de nombres de policy: "sede_isolation_<tabla>".
-- Se usa `FOR ALL` (cubre SELECT/INSERT/UPDATE/DELETE) con `USING` + `WITH
-- CHECK` iguales, salvo en `registro_auditoria` (solo INSERT+SELECT, ver
-- regla 5.5 de CLAUDE.md — auditoría es de solo inserción, ni siquiera RLS
-- le da permiso de UPDATE/DELETE a nadie sujeto a esta capa).
--
-- Nota sobre GRANTs: habilitar RLS y escribir la policy no basta — el rol
-- `authenticated` también necesita el privilegio de tabla correspondiente
-- (GRANT SELECT/INSERT/...), si no, Postgres rechaza el statement ANTES de
-- llegar a evaluar la policy. Las tablas creadas por Prisma NO traen esos
-- GRANTs automáticos (a diferencia de tablas creadas desde Supabase Studio),
-- así que se agregan explícitamente aquí.

-- ============================================================
-- SEDES (la propia fila de sede — un usuario solo ve/edita la suya)
-- ============================================================
ALTER TABLE "sedes" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "sedes" TO authenticated;

CREATE POLICY "sede_isolation_sedes" ON "sedes"
  FOR ALL
  USING (id = public.current_sede_id())
  WITH CHECK (id = public.current_sede_id());

-- ============================================================
-- SEDE_RESPONSABLES (sede_id directo)
-- ============================================================
ALTER TABLE "sede_responsables" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "sede_responsables" TO authenticated;

CREATE POLICY "sede_isolation_sede_responsables" ON "sede_responsables"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- SALONES (sede_id directo)
-- ============================================================
ALTER TABLE "salones" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "salones" TO authenticated;

CREATE POLICY "sede_isolation_salones" ON "salones"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- CARRERAS (sede_id directo)
-- ============================================================
ALTER TABLE "carreras" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "carreras" TO authenticated;

CREATE POLICY "sede_isolation_carreras" ON "carreras"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- MALLAS_CURRICULARES (indirecto vía carreras.sede_id)
-- ============================================================
ALTER TABLE "mallas_curriculares" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "mallas_curriculares" TO authenticated;

CREATE POLICY "sede_isolation_mallas_curriculares" ON "mallas_curriculares"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "carreras" c
      WHERE c.id = "mallas_curriculares".carrera_id
        AND c.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "carreras" c
      WHERE c.id = "mallas_curriculares".carrera_id
        AND c.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- GRUPOS (sede_id directo)
-- ============================================================
ALTER TABLE "grupos" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "grupos" TO authenticated;

CREATE POLICY "sede_isolation_grupos" ON "grupos"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- GRUPO_ALUMNOS (indirecto vía grupos.sede_id)
-- ============================================================
ALTER TABLE "grupo_alumnos" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "grupo_alumnos" TO authenticated;

CREATE POLICY "sede_isolation_grupo_alumnos" ON "grupo_alumnos"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "grupos" g
      WHERE g.id = "grupo_alumnos".grupo_id
        AND g.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "grupos" g
      WHERE g.id = "grupo_alumnos".grupo_id
        AND g.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- MATERIAS (indirecto vía carreras.sede_id)
-- ============================================================
ALTER TABLE "materias" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "materias" TO authenticated;

CREATE POLICY "sede_isolation_materias" ON "materias"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "carreras" c
      WHERE c.id = "materias".carrera_id
        AND c.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "carreras" c
      WHERE c.id = "materias".carrera_id
        AND c.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- USUARIOS (sede_id directo)
-- ============================================================
ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "usuarios" TO authenticated;

CREATE POLICY "sede_isolation_usuarios" ON "usuarios"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- PERFILES_ALUMNO (indirecto vía usuarios.sede_id)
-- ============================================================
ALTER TABLE "perfiles_alumno" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "perfiles_alumno" TO authenticated;

CREATE POLICY "sede_isolation_perfiles_alumno" ON "perfiles_alumno"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "usuarios" u
      WHERE u.id = "perfiles_alumno".usuario_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "usuarios" u
      WHERE u.id = "perfiles_alumno".usuario_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- CONTACTOS_ALUMNO (indirecto vía perfiles_alumno -> usuarios.sede_id)
-- ============================================================
ALTER TABLE "contactos_alumno" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "contactos_alumno" TO authenticated;

CREATE POLICY "sede_isolation_contactos_alumno" ON "contactos_alumno"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "perfiles_alumno" pa
      JOIN "usuarios" u ON u.id = pa.usuario_id
      WHERE pa.id = "contactos_alumno".alumno_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "perfiles_alumno" pa
      JOIN "usuarios" u ON u.id = pa.usuario_id
      WHERE pa.id = "contactos_alumno".alumno_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- INFO_MEDICA_ALUMNO (indirecto vía perfiles_alumno -> usuarios.sede_id)
-- ============================================================
ALTER TABLE "info_medica_alumno" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "info_medica_alumno" TO authenticated;

CREATE POLICY "sede_isolation_info_medica_alumno" ON "info_medica_alumno"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "perfiles_alumno" pa
      JOIN "usuarios" u ON u.id = pa.usuario_id
      WHERE pa.id = "info_medica_alumno".alumno_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "perfiles_alumno" pa
      JOIN "usuarios" u ON u.id = pa.usuario_id
      WHERE pa.id = "info_medica_alumno".alumno_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- PERFILES_MAESTRO (indirecto vía usuarios.sede_id)
-- ============================================================
ALTER TABLE "perfiles_maestro" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "perfiles_maestro" TO authenticated;

CREATE POLICY "sede_isolation_perfiles_maestro" ON "perfiles_maestro"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "usuarios" u
      WHERE u.id = "perfiles_maestro".usuario_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "usuarios" u
      WHERE u.id = "perfiles_maestro".usuario_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- CONTACTOS_MAESTRO (indirecto vía perfiles_maestro -> usuarios.sede_id)
-- ============================================================
ALTER TABLE "contactos_maestro" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "contactos_maestro" TO authenticated;

CREATE POLICY "sede_isolation_contactos_maestro" ON "contactos_maestro"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "perfiles_maestro" pm
      JOIN "usuarios" u ON u.id = pm.usuario_id
      WHERE pm.id = "contactos_maestro".maestro_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "perfiles_maestro" pm
      JOIN "usuarios" u ON u.id = pm.usuario_id
      WHERE pm.id = "contactos_maestro".maestro_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- INFO_MEDICA_MAESTRO (indirecto vía perfiles_maestro -> usuarios.sede_id)
-- ============================================================
ALTER TABLE "info_medica_maestro" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "info_medica_maestro" TO authenticated;

CREATE POLICY "sede_isolation_info_medica_maestro" ON "info_medica_maestro"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "perfiles_maestro" pm
      JOIN "usuarios" u ON u.id = pm.usuario_id
      WHERE pm.id = "info_medica_maestro".maestro_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "perfiles_maestro" pm
      JOIN "usuarios" u ON u.id = pm.usuario_id
      WHERE pm.id = "info_medica_maestro".maestro_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- PERFILES_ADMINISTRATIVO (indirecto vía usuarios.sede_id)
-- ============================================================
ALTER TABLE "perfiles_administrativo" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "perfiles_administrativo" TO authenticated;

CREATE POLICY "sede_isolation_perfiles_administrativo" ON "perfiles_administrativo"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "usuarios" u
      WHERE u.id = "perfiles_administrativo".usuario_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "usuarios" u
      WHERE u.id = "perfiles_administrativo".usuario_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- CONTACTOS_ADMINISTRATIVO (indirecto vía perfiles_administrativo -> usuarios.sede_id)
-- ============================================================
ALTER TABLE "contactos_administrativo" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "contactos_administrativo" TO authenticated;

CREATE POLICY "sede_isolation_contactos_administrativo" ON "contactos_administrativo"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "perfiles_administrativo" pad
      JOIN "usuarios" u ON u.id = pad.usuario_id
      WHERE pad.id = "contactos_administrativo".administrativo_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "perfiles_administrativo" pad
      JOIN "usuarios" u ON u.id = pad.usuario_id
      WHERE pad.id = "contactos_administrativo".administrativo_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- INFO_MEDICA_ADMINISTRATIVO (indirecto vía perfiles_administrativo -> usuarios.sede_id)
-- ============================================================
ALTER TABLE "info_medica_administrativo" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "info_medica_administrativo" TO authenticated;

CREATE POLICY "sede_isolation_info_medica_administrativo" ON "info_medica_administrativo"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "perfiles_administrativo" pad
      JOIN "usuarios" u ON u.id = pad.usuario_id
      WHERE pad.id = "info_medica_administrativo".administrativo_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "perfiles_administrativo" pad
      JOIN "usuarios" u ON u.id = pad.usuario_id
      WHERE pad.id = "info_medica_administrativo".administrativo_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- PERSONAL_SERVICIOS (sede_id directo)
-- ============================================================
ALTER TABLE "personal_servicios" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "personal_servicios" TO authenticated;

CREATE POLICY "sede_isolation_personal_servicios" ON "personal_servicios"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- CONTACTOS_PERSONAL_SERVICIOS (indirecto vía personal_servicios.sede_id)
-- ============================================================
ALTER TABLE "contactos_personal_servicios" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "contactos_personal_servicios" TO authenticated;

CREATE POLICY "sede_isolation_contactos_personal_servicios" ON "contactos_personal_servicios"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "personal_servicios" ps
      WHERE ps.id = "contactos_personal_servicios".personal_servicios_id
        AND ps.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "personal_servicios" ps
      WHERE ps.id = "contactos_personal_servicios".personal_servicios_id
        AND ps.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- INFO_MEDICA_PERSONAL_SERVICIOS (indirecto vía personal_servicios.sede_id)
-- ============================================================
ALTER TABLE "info_medica_personal_servicios" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "info_medica_personal_servicios" TO authenticated;

CREATE POLICY "sede_isolation_info_medica_personal_servicios" ON "info_medica_personal_servicios"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "personal_servicios" ps
      WHERE ps.id = "info_medica_personal_servicios".personal_servicios_id
        AND ps.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "personal_servicios" ps
      WHERE ps.id = "info_medica_personal_servicios".personal_servicios_id
        AND ps.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- REGISTRO_AUDITORIA (sede_id directo, SOLO SELECT + INSERT — regla 5.5)
-- ============================================================
-- Tabla de solo inserción (regla 5.5 de CLAUDE.md): nadie, ni siquiera
-- SUPER_ADMIN, puede editar o borrar un registro de auditoría desde la app.
-- A propósito NO se otorga UPDATE ni DELETE al rol `authenticated`, y a
-- propósito NO existe policy de UPDATE/DELETE — sin policy, el comando queda
-- bloqueado por RLS aunque alguien intentara forzarlo.
ALTER TABLE "registro_auditoria" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON "registro_auditoria" TO authenticated;

CREATE POLICY "sede_isolation_registro_auditoria_select" ON "registro_auditoria"
  FOR SELECT
  USING (sede_id = public.current_sede_id());

CREATE POLICY "sede_isolation_registro_auditoria_insert" ON "registro_auditoria"
  FOR INSERT
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- PERMISOS_ADMINISTRATIVO (indirecto vía perfiles_administrativo -> usuarios.sede_id)
-- ============================================================
ALTER TABLE "permisos_administrativo" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "permisos_administrativo" TO authenticated;

CREATE POLICY "sede_isolation_permisos_administrativo" ON "permisos_administrativo"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "perfiles_administrativo" pad
      JOIN "usuarios" u ON u.id = pad.usuario_id
      WHERE pad.id = "permisos_administrativo".administrativo_id
        AND u.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "perfiles_administrativo" pad
      JOIN "usuarios" u ON u.id = pad.usuario_id
      WHERE pad.id = "permisos_administrativo".administrativo_id
        AND u.sede_id = public.current_sede_id()
    )
  );

-- ============================================================
-- SECCIONES — catálogo GLOBAL, no tiene sede_id (ni directo ni indirecto)
-- ============================================================
-- No aplica aislamiento por sede porque conceptualmente no pertenece a
-- ninguna sede — es un catálogo compartido (ej. "Alumnos", "Reportes") usado
-- por PermisoAdministrativo en todas las sedes por igual. Se deja de solo
-- lectura para `authenticated` (RLS ya la había dejado bloqueada por
-- completo desde que se creó, por el ajuste "Enable automatic RLS" del
-- proyecto — sin esta policy quedaría inaccesible para siempre). Las altas o
-- ediciones de este catálogo son una operación administrativa poco frecuente
-- que se hace desde el backend con el rol `postgres` (bypassa RLS), no desde
-- `authenticated` directamente.
ALTER TABLE "secciones" ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON "secciones" TO authenticated;

CREATE POLICY "secciones_lectura_global" ON "secciones"
  FOR SELECT
  USING (true);

-- ----------------------------------------------------------------------------
-- 3) Auth Hook — custom claim `sede_id` embebido en el JWT al hacer login
-- ----------------------------------------------------------------------------
-- Convención oficial de Supabase para un "Custom Access Token Hook": una
-- función en `public` (o cualquier esquema no expuesto por la Data API) que
-- Supabase Auth invoca ANTES de firmar el JWT, con el `user_id` de quien
-- está iniciando sesión. Regresa el `event` con los claims ya modificados.
--
-- ⚠️ PASO MANUAL PENDIENTE (no lo puede hacer este agente — no hay CLI de
-- Supabase enlazado a este proyecto, y activar el hook es una acción del
-- Dashboard, no de SQL):
--
--   1. Supabase Dashboard → Authentication → Hooks
--   2. "Customize Access Token (Claims) Hook" → seleccionar esta función:
--      `public.custom_access_token_hook`
--   3. Guardar y habilitar el hook.
--
-- Sin ese paso, la función existe en la base de datos pero Supabase Auth
-- nunca la invoca — los JWT emitidos NO tendrán el claim `sede_id` hasta que
-- se active manualmente desde el Dashboard.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  v_sede_id text;
BEGIN
  -- Busca la sede del usuario que está iniciando sesión. `usuarios.id` es el
  -- mismo UUID (guardado como TEXT, ver nota en current_sede_id() arriba)
  -- que Supabase Auth usa como `user_id` (regla 5.9 de CLAUDE.md).
  SELECT sede_id INTO v_sede_id
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

  event := jsonb_set(event, '{claims}', claims);

  RETURN event;
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Auth Hook de Supabase (Custom Access Token Hook) — embebe el claim '
  'sede_id en el JWT a partir de usuarios.sede_id. Requiere activarse '
  'manualmente en Dashboard -> Authentication -> Hooks (Fase 1, Día 5).';

-- Supabase invoca los Auth Hooks con el rol `supabase_auth_admin`, NO con el
-- rol del usuario que hace login. Sin este GRANT explícito, el hook fallaría
-- con "permission denied" en cuanto Supabase intentara ejecutarlo.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- El resto de roles no deben poder invocar el hook directamente (es lógica
-- interna de Auth, no un endpoint de negocio).
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- El hook necesita poder leer `usuarios` para resolver la sede, sin importar
-- las policies de RLS de esa tabla (el hook corre antes de que exista
-- cualquier JWT/sesión, así que `current_sede_id()` todavía no tiene nada
-- que leer). Se le da SELECT explícito sobre esa columna vía GRANT — no hace
-- falta bypassear RLS por completo, basta con que `supabase_auth_admin`
-- pueda hacer SELECT y quede exento de la policy con una policy adicional
-- dedicada a este rol.
GRANT SELECT ON public.usuarios TO supabase_auth_admin;

CREATE POLICY "auth_hook_lectura_usuarios" ON "usuarios"
  FOR SELECT
  TO supabase_auth_admin
  USING (true);
