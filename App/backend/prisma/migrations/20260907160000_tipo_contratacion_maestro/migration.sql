-- CreateEnum
CREATE TYPE "TipoContratacion" AS ENUM ('BASE', 'TEMPORAL', 'CONTRATO');

-- AlterTable
ALTER TABLE "perfiles_maestro" ADD COLUMN     "contrato_fecha_fin" TIMESTAMP(3),
ADD COLUMN     "contrato_fecha_inicio" TIMESTAMP(3),
ADD COLUMN     "dias_temporal" INTEGER,
ADD COLUMN     "tipo_contratacion" "TipoContratacion";

