-- CreateEnum
CREATE TYPE "EstatusReporteBug" AS ENUM ('NUEVO', 'EN_REVISION', 'RESUELTO');

-- CreateTable
CREATE TABLE "configuracion_soporte" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_soporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reportes_bug" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "captura_storage_path" TEXT,
    "estatus" "EstatusReporteBug" NOT NULL DEFAULT 'NUEVO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reportes_bug_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reportes_bug_estatus_created_at_idx" ON "reportes_bug"("estatus", "created_at");

-- AddForeignKey
ALTER TABLE "reportes_bug" ADD CONSTRAINT "reportes_bug_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reportes_bug" ADD CONSTRAINT "reportes_bug_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: fila única de configuración (singleton) — sin esto, la primera
-- llamada a GET /soporte/config fallaría contra una tabla vacía.
INSERT INTO "configuracion_soporte" ("id", "activo", "updated_at")
VALUES ('global', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ============================================================
-- REPORTES_BUG (sede_id directo) — mismo patrón que telefonos_emergencia_sede
-- ============================================================
ALTER TABLE "reportes_bug" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "reportes_bug" TO authenticated;

CREATE POLICY "sede_isolation_reportes_bug" ON "reportes_bug"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- CONFIGURACION_SOPORTE — global (sin sede_id). RLS habilitada SIN
-- policies (mismo criterio que admin_plataforma): cerrado por default
-- para authenticated/anon. El backend conecta como rol postgres y
-- bypassa RLS de cualquier forma — esto es defensa en profundidad, el
-- control de acceso real es PlatformAdminGuard/RolesGuard.
-- ============================================================
ALTER TABLE "configuracion_soporte" ENABLE ROW LEVEL SECURITY;
