-- CreateEnum
CREATE TYPE "TipoSangre" AS ENUM ('A_POSITIVO', 'A_NEGATIVO', 'B_POSITIVO', 'B_NEGATIVO', 'AB_POSITIVO', 'AB_NEGATIVO', 'O_POSITIVO', 'O_NEGATIVO');

-- AlterTable
ALTER TABLE "carreras" ADD COLUMN     "procedencia_rvoe" TEXT,
ALTER COLUMN "rvoe" DROP NOT NULL;

-- AlterTable
ALTER TABLE "info_medica_administrativo" ADD COLUMN     "tipo_sangre" "TipoSangre";

-- AlterTable
ALTER TABLE "info_medica_alumno" ADD COLUMN     "tipo_sangre" "TipoSangre";

-- AlterTable
ALTER TABLE "info_medica_maestro" ADD COLUMN     "tipo_sangre" "TipoSangre";

-- AlterTable
ALTER TABLE "info_medica_personal_servicios" ADD COLUMN     "tipo_sangre" "TipoSangre";
