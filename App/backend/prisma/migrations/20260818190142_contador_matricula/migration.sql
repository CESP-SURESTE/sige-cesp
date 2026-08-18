-- CreateTable
CREATE TABLE "contador_matricula" (
    "anio" INTEGER NOT NULL,
    "ultimo_numero" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contador_matricula_pkey" PRIMARY KEY ("anio")
);
