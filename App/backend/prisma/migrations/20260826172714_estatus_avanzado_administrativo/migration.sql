-- CreateEnum
CREATE TYPE "TipoLicencia" AS ENUM ('VACACIONES', 'INCAPACIDAD_ENFERMEDAD_GENERAL', 'INCAPACIDAD_RIESGO_TRABAJO', 'MATERNIDAD', 'PATERNIDAD', 'ADOPCION', 'PERMISO_CON_GOCE_SUELDO', 'PERMISO_SIN_GOCE_SUELDO', 'OTRO');

-- CreateEnum
CREATE TYPE "MotivoBaja" AS ENUM ('RENUNCIA', 'DESPIDO', 'BAJA_TEMPORAL_SALUD', 'OTRO');

-- AlterTable
ALTER TABLE "perfiles_administrativo" ADD COLUMN     "motivo_baja" "MotivoBaja",
ADD COLUMN     "tipo_licencia" "TipoLicencia";

-- AlterTable
ALTER TABLE "perfiles_maestro" ADD COLUMN     "motivo_baja" "MotivoBaja",
ADD COLUMN     "tipo_licencia" "TipoLicencia";
