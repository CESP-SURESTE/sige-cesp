-- CreateTable
CREATE TABLE "telefonos_emergencia_sede" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telefonos_emergencia_sede_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telefonos_emergencia_sede_sede_id_idx" ON "telefonos_emergencia_sede"("sede_id");

-- AddForeignKey
ALTER TABLE "telefonos_emergencia_sede" ADD CONSTRAINT "telefonos_emergencia_sede_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- TELEFONOS DE EMERGENCIA POR SEDE (sede_id directo)
-- ============================================================
ALTER TABLE "telefonos_emergencia_sede" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "telefonos_emergencia_sede" TO authenticated;

CREATE POLICY "sede_isolation_telefonos_emergencia_sede" ON "telefonos_emergencia_sede"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());
