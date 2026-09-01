-- DropForeignKey
ALTER TABLE "notificaciones" DROP CONSTRAINT "notificaciones_usuario_id_fkey";

-- CreateIndex
CREATE INDEX "notificaciones_usuario_id_created_at_idx" ON "notificaciones"("usuario_id", "created_at");

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
