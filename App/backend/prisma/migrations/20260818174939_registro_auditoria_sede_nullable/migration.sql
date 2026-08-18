-- DropForeignKey
ALTER TABLE "registro_auditoria" DROP CONSTRAINT "registro_auditoria_sede_id_fkey";

-- AlterTable
ALTER TABLE "registro_auditoria" ALTER COLUMN "sede_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "registro_auditoria" ADD CONSTRAINT "registro_auditoria_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

