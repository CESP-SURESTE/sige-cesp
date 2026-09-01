-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('AVISO', 'RECORDATORIO_EVENTO');

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "referencia_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo_corto" TEXT NOT NULL,
    "leido_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notificaciones_usuario_id_leido_en_idx" ON "notificaciones"("usuario_id", "leido_en");

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- NOTIFICACIONES (sede_id directo)
-- ============================================================
ALTER TABLE "notificaciones" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "notificaciones" TO authenticated;

CREATE POLICY "sede_isolation_notificaciones" ON "notificaciones"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());
