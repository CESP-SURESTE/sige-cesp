-- CreateTable
CREATE TABLE "avisos" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "autor_usuario_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "alcance_tipo" "AlcanceDestino" NOT NULL,
    "alcance_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avisos_sede_id_created_at_idx" ON "avisos"("sede_id", "created_at");

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_autor_usuario_id_fkey" FOREIGN KEY ("autor_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- AVISOS (sede_id directo)
-- ============================================================
ALTER TABLE "avisos" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "avisos" TO authenticated;

CREATE POLICY "sede_isolation_avisos" ON "avisos"
  FOR ALL
  USING (sede_id = public.current_sede_id())
  WITH CHECK (sede_id = public.current_sede_id());
