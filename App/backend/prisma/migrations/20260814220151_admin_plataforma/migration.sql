-- DropForeignKey
ALTER TABLE "registro_auditoria" DROP CONSTRAINT "registro_auditoria_usuario_id_fkey";

-- AlterTable
ALTER TABLE "registro_auditoria" ADD COLUMN     "admin_plataforma_id" TEXT,
ALTER COLUMN "usuario_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "admin_plataforma" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_plataforma_email_key" ON "admin_plataforma"("email");

-- AddForeignKey
ALTER TABLE "registro_auditoria" ADD CONSTRAINT "registro_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_auditoria" ADD CONSTRAINT "registro_auditoria_admin_plataforma_id_fkey" FOREIGN KEY ("admin_plataforma_id") REFERENCES "admin_plataforma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Fase 6, Día 20 — CHECK: un RegistroAuditoria tiene exactamente un actor
-- (Usuario XOR AdminPlataforma), nunca ambos, nunca ninguno.
-- ============================================================================
ALTER TABLE "registro_auditoria"
  ADD CONSTRAINT "registro_auditoria_actor_check"
  CHECK (("usuario_id" IS NOT NULL) != ("admin_plataforma_id" IS NOT NULL));

-- ============================================================================
-- ADMIN_PLATAFORMA — sin sede_id (por diseño, es una identidad cross-sede).
-- RLS habilitada SIN ninguna policy: cerrado por default para
-- authenticated/anon (mismo patrón que sede_responsables, sin policy de
-- UPDATE/DELETE, ver 20260806224102_rls_multisede/migration.sql). El backend
-- conecta como rol postgres y bypassa RLS (ver comentario en esa misma
-- migración) — esto es defensa en profundidad, no el mecanismo real de
-- control de acceso (ese es PlatformAdminGuard).
-- ============================================================================
ALTER TABLE "admin_plataforma" ENABLE ROW LEVEL SECURITY;
