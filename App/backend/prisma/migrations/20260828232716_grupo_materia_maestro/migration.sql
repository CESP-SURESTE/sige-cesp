-- CreateTable
CREATE TABLE "grupo_materia_maestro" (
    "id" TEXT NOT NULL,
    "grupo_id" TEXT NOT NULL,
    "materia_id" TEXT NOT NULL,
    "maestro_id" TEXT NOT NULL,
    "asignado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grupo_materia_maestro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grupo_materia_maestro_grupo_id_materia_id_maestro_id_key" ON "grupo_materia_maestro"("grupo_id", "materia_id", "maestro_id");

-- AddForeignKey
ALTER TABLE "grupo_materia_maestro" ADD CONSTRAINT "grupo_materia_maestro_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "grupos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupo_materia_maestro" ADD CONSTRAINT "grupo_materia_maestro_materia_id_fkey" FOREIGN KEY ("materia_id") REFERENCES "materias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupo_materia_maestro" ADD CONSTRAINT "grupo_materia_maestro_maestro_id_fkey" FOREIGN KEY ("maestro_id") REFERENCES "perfiles_maestro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- GRUPO_MATERIA_MAESTRO (indirecto vía grupos.sede_id)
-- ============================================================
ALTER TABLE "grupo_materia_maestro" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "grupo_materia_maestro" TO authenticated;

CREATE POLICY "sede_isolation_grupo_materia_maestro" ON "grupo_materia_maestro"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "grupos" g
      WHERE g.id = "grupo_materia_maestro".grupo_id
        AND g.sede_id = public.current_sede_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "grupos" g
      WHERE g.id = "grupo_materia_maestro".grupo_id
        AND g.sede_id = public.current_sede_id()
    )
  );
