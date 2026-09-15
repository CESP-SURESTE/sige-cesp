-- CreateEnum
CREATE TYPE "CategoriaEvento" AS ENUM ('EXAMEN', 'SOCIAL', 'ADMINISTRATIVO', 'SUSPENSION_CLASES', 'OTRO');

-- CreateEnum
CREATE TYPE "AlcanceDestino" AS ENUM ('SEDE', 'CARRERA', 'GRUPO');

-- CreateTable
CREATE TABLE "eventos_calendario" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "autor_usuario_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "fecha_inicio" DATE NOT NULL,
    "hora_inicio" TEXT,
    "fecha_fin" DATE,
    "categoria" "CategoriaEvento" NOT NULL,
    "alcance_tipo" "AlcanceDestino" NOT NULL,
    "alcance_id" TEXT,
    "recurrencia_regla" JSONB,
    "recurrencia_hasta" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eventos_calendario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordatorio_enviado" (
    "id" TEXT NOT NULL,
    "evento_id" TEXT NOT NULL,
    "fecha_ocurrencia" DATE NOT NULL,
    "enviado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recordatorio_enviado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recordatorio_enviado_evento_id_fecha_ocurrencia_key" ON "recordatorio_enviado"("evento_id", "fecha_ocurrencia");

-- AddForeignKey
ALTER TABLE "eventos_calendario" ADD CONSTRAINT "eventos_calendario_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_calendario" ADD CONSTRAINT "eventos_calendario_autor_usuario_id_fkey" FOREIGN KEY ("autor_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordatorio_enviado" ADD CONSTRAINT "recordatorio_enviado_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos_calendario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- EVENTOS_CALENDARIO (sede_id directo)
-- ============================================================
ALTER TABLE "eventos_calendario" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "eventos_calendario" TO authenticated;

CREATE POLICY "sede_isolation_eventos_calendario" ON "eventos_calendario"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());

-- ============================================================
-- RECORDATORIO_ENVIADO (sede_id indirecto vía eventos_calendario)
-- ============================================================
ALTER TABLE "recordatorio_enviado" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "recordatorio_enviado" TO authenticated;

CREATE POLICY "sede_isolation_recordatorio_enviado" ON "recordatorio_enviado"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "eventos_calendario" e
      WHERE e.id = "recordatorio_enviado".evento_id
        AND e.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "eventos_calendario" e
      WHERE e.id = "recordatorio_enviado".evento_id
        AND e.sede_id = public.current_sede_id()
    )
  );
