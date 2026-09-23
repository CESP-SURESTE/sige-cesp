-- Habilita RLS en `contador_matricula` (tabla global, sin `sedeId`, sin
-- policies -- mismo patrón que `admin_plataforma`: el acceso real lo hace
-- el backend con el rol que bypassea RLS). Hallazgo de auditoría de
-- consolidación (Opus, 2026-09-22): era la única de 32 tablas sin RLS
-- habilitado, violando la regla 2 de CLAUDE.md ("doble capa RLS + Guards").
ALTER TABLE "contador_matricula" ENABLE ROW LEVEL SECURITY;
