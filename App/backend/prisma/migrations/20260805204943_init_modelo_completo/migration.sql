-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ALUMNO', 'MAESTRO', 'ADMINISTRATIVO');

-- CreateEnum
CREATE TYPE "EstatusAcademico" AS ENUM ('INSCRITO', 'BAJA_TEMPORAL', 'BAJA_DEFINITIVA', 'EGRESADO');

-- CreateEnum
CREATE TYPE "TipoContacto" AS ENUM ('TUTOR', 'EMERGENCIA');

-- CreateEnum
CREATE TYPE "EstatusEmpleado" AS ENUM ('ACTIVO', 'BAJA', 'LICENCIA');

-- CreateEnum
CREATE TYPE "PuestoAdministrativo" AS ENUM ('DIRECTOR', 'COORDINADOR_ACADEMICO', 'COORDINADOR_ADMINISTRATIVO', 'AUXILIAR', 'RECEPCION', 'OTRO');

-- CreateEnum
CREATE TYPE "NivelPermiso" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'AUXILIAR');

-- CreateEnum
CREATE TYPE "AccionAuditoria" AS ENUM ('ALTA', 'BAJA', 'EDICION', 'CAMBIO_PERMISO', 'CAMBIO_ESTATUS', 'ELIMINACION');

-- CreateEnum
CREATE TYPE "NivelCarrera" AS ENUM ('TECNICO', 'LICENCIATURA', 'MAESTRIA', 'DOCTORADO');

-- CreateEnum
CREATE TYPE "ModalidadCarrera" AS ENUM ('PRESENCIAL', 'SEMIPRESENCIAL', 'EN_LINEA');

-- CreateEnum
CREATE TYPE "EstatusCarrera" AS ENUM ('ACTIVA', 'INACTIVA');

-- CreateEnum
CREATE TYPE "AreaPersonalServicios" AS ENUM ('INTENDENCIA', 'SEGURIDAD', 'JARDINERIA', 'MANTENIMIENTO', 'OTRO');

-- CreateTable
CREATE TABLE "sedes" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "ubicacion_referencia" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "costo_renta" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sedes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sede_responsables" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "administrativo_id" TEXT NOT NULL,
    "es_principal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sede_responsables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salones" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "capacidad" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carreras" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "duracion" INTEGER NOT NULL,
    "nivel" "NivelCarrera" NOT NULL,
    "modalidad" "ModalidadCarrera" NOT NULL,
    "estatus" "EstatusCarrera" NOT NULL DEFAULT 'ACTIVA',
    "rvoe" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carreras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mallas_curriculares" (
    "id" TEXT NOT NULL,
    "carrera_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "subida_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subida_por" TEXT NOT NULL,

    CONSTRAINT "mallas_curriculares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grupos" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "carrera_id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "anio_inicio" INTEGER NOT NULL,
    "ciclo_actual" INTEGER NOT NULL,
    "capacidad" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grupos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grupo_alumnos" (
    "id" TEXT NOT NULL,
    "grupo_id" TEXT NOT NULL,
    "alumno_id" TEXT NOT NULL,
    "fecha_inscripcion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grupo_alumnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materias" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "carrera_id" TEXT NOT NULL,
    "ciclo" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "materias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "sede_id" TEXT NOT NULL,
    "codigo_externo" TEXT,
    "primer_ingreso" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acceso" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfiles_alumno" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellido_paterno" TEXT NOT NULL,
    "apellido_materno" TEXT,
    "curp" TEXT,
    "fecha_nacimiento" TIMESTAMP(3) NOT NULL,
    "matricula" TEXT NOT NULL,
    "correo_personal" TEXT NOT NULL,
    "carrera_id" TEXT NOT NULL,
    "estatus_academico" "EstatusAcademico" NOT NULL,
    "periodo_ingreso" TEXT NOT NULL,
    "semestre_actual" INTEGER NOT NULL,
    "telefono" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfiles_alumno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contactos_alumno" (
    "id" TEXT NOT NULL,
    "alumno_id" TEXT NOT NULL,
    "tipo" "TipoContacto" NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo" TEXT,
    "parentesco" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "contactos_alumno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "info_medica_alumno" (
    "id" TEXT NOT NULL,
    "alumno_id" TEXT NOT NULL,
    "tiene_condicion_medica" BOOLEAN NOT NULL DEFAULT false,
    "padecimiento" TEXT,
    "medicamentos" TEXT,
    "alergias" TEXT,
    "tratamiento_adicional" TEXT,

    CONSTRAINT "info_medica_alumno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfiles_maestro" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellido_paterno" TEXT NOT NULL,
    "apellido_materno" TEXT,
    "curp" TEXT NOT NULL,
    "cedula_profesional" TEXT,
    "correo_personal" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "fecha_contratacion" TIMESTAMP(3) NOT NULL,
    "estatus" "EstatusEmpleado" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfiles_maestro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contactos_maestro" (
    "id" TEXT NOT NULL,
    "maestro_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo" TEXT,
    "parentesco" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "contactos_maestro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "info_medica_maestro" (
    "id" TEXT NOT NULL,
    "maestro_id" TEXT NOT NULL,
    "tiene_condicion_medica" BOOLEAN NOT NULL DEFAULT false,
    "padecimiento" TEXT,
    "medicamentos" TEXT,
    "alergias" TEXT,
    "tratamiento_adicional" TEXT,

    CONSTRAINT "info_medica_maestro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfiles_administrativo" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellido_paterno" TEXT NOT NULL,
    "apellido_materno" TEXT,
    "curp" TEXT NOT NULL,
    "correo_personal" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "fecha_contratacion" TIMESTAMP(3) NOT NULL,
    "estatus" "EstatusEmpleado" NOT NULL,
    "puesto" "PuestoAdministrativo" NOT NULL,
    "nivel_permiso" "NivelPermiso" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfiles_administrativo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contactos_administrativo" (
    "id" TEXT NOT NULL,
    "administrativo_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo" TEXT,
    "parentesco" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "contactos_administrativo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "info_medica_administrativo" (
    "id" TEXT NOT NULL,
    "administrativo_id" TEXT NOT NULL,
    "tiene_condicion_medica" BOOLEAN NOT NULL DEFAULT false,
    "padecimiento" TEXT,
    "medicamentos" TEXT,
    "alergias" TEXT,
    "tratamiento_adicional" TEXT,

    CONSTRAINT "info_medica_administrativo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_servicios" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellido_paterno" TEXT NOT NULL,
    "apellido_materno" TEXT,
    "curp" TEXT NOT NULL,
    "area" "AreaPersonalServicios" NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo_personal" TEXT,
    "fecha_contratacion" TIMESTAMP(3) NOT NULL,
    "estatus" "EstatusEmpleado" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contactos_personal_servicios" (
    "id" TEXT NOT NULL,
    "personal_servicios_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo" TEXT,
    "parentesco" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "contactos_personal_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "info_medica_personal_servicios" (
    "id" TEXT NOT NULL,
    "personal_servicios_id" TEXT NOT NULL,
    "tiene_condicion_medica" BOOLEAN NOT NULL DEFAULT false,
    "padecimiento" TEXT,
    "medicamentos" TEXT,
    "alergias" TEXT,
    "tratamiento_adicional" TEXT,

    CONSTRAINT "info_medica_personal_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_auditoria" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "accion" "AccionAuditoria" NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "detalle" JSONB,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secciones" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "clave" TEXT NOT NULL,

    CONSTRAINT "secciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos_administrativo" (
    "id" TEXT NOT NULL,
    "administrativo_id" TEXT NOT NULL,
    "seccion_id" TEXT NOT NULL,
    "puede_ver" BOOLEAN NOT NULL DEFAULT true,
    "puede_editar" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permisos_administrativo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sedes_nombre_key" ON "sedes"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "sede_responsables_sede_id_administrativo_id_key" ON "sede_responsables"("sede_id", "administrativo_id");

-- CreateIndex
CREATE UNIQUE INDEX "salones_sede_id_nombre_key" ON "salones"("sede_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "carreras_clave_key" ON "carreras"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "mallas_curriculares_carrera_id_key" ON "mallas_curriculares"("carrera_id");

-- CreateIndex
CREATE UNIQUE INDEX "grupo_alumnos_grupo_id_alumno_id_key" ON "grupo_alumnos"("grupo_id", "alumno_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_codigo_externo_key" ON "usuarios"("codigo_externo");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_alumno_usuario_id_key" ON "perfiles_alumno"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_alumno_matricula_key" ON "perfiles_alumno"("matricula");

-- CreateIndex
CREATE UNIQUE INDEX "info_medica_alumno_alumno_id_key" ON "info_medica_alumno"("alumno_id");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_maestro_usuario_id_key" ON "perfiles_maestro"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "info_medica_maestro_maestro_id_key" ON "info_medica_maestro"("maestro_id");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_administrativo_usuario_id_key" ON "perfiles_administrativo"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "info_medica_administrativo_administrativo_id_key" ON "info_medica_administrativo"("administrativo_id");

-- CreateIndex
CREATE UNIQUE INDEX "info_medica_personal_servicios_personal_servicios_id_key" ON "info_medica_personal_servicios"("personal_servicios_id");

-- CreateIndex
CREATE UNIQUE INDEX "secciones_nombre_key" ON "secciones"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "secciones_clave_key" ON "secciones"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_administrativo_administrativo_id_seccion_id_key" ON "permisos_administrativo"("administrativo_id", "seccion_id");

-- AddForeignKey
ALTER TABLE "sede_responsables" ADD CONSTRAINT "sede_responsables_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sede_responsables" ADD CONSTRAINT "sede_responsables_administrativo_id_fkey" FOREIGN KEY ("administrativo_id") REFERENCES "perfiles_administrativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salones" ADD CONSTRAINT "salones_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carreras" ADD CONSTRAINT "carreras_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mallas_curriculares" ADD CONSTRAINT "mallas_curriculares_carrera_id_fkey" FOREIGN KEY ("carrera_id") REFERENCES "carreras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mallas_curriculares" ADD CONSTRAINT "mallas_curriculares_subida_por_fkey" FOREIGN KEY ("subida_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupos" ADD CONSTRAINT "grupos_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupos" ADD CONSTRAINT "grupos_carrera_id_fkey" FOREIGN KEY ("carrera_id") REFERENCES "carreras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupos" ADD CONSTRAINT "grupos_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupo_alumnos" ADD CONSTRAINT "grupo_alumnos_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "grupos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupo_alumnos" ADD CONSTRAINT "grupo_alumnos_alumno_id_fkey" FOREIGN KEY ("alumno_id") REFERENCES "perfiles_alumno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materias" ADD CONSTRAINT "materias_carrera_id_fkey" FOREIGN KEY ("carrera_id") REFERENCES "carreras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles_alumno" ADD CONSTRAINT "perfiles_alumno_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles_alumno" ADD CONSTRAINT "perfiles_alumno_carrera_id_fkey" FOREIGN KEY ("carrera_id") REFERENCES "carreras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactos_alumno" ADD CONSTRAINT "contactos_alumno_alumno_id_fkey" FOREIGN KEY ("alumno_id") REFERENCES "perfiles_alumno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "info_medica_alumno" ADD CONSTRAINT "info_medica_alumno_alumno_id_fkey" FOREIGN KEY ("alumno_id") REFERENCES "perfiles_alumno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles_maestro" ADD CONSTRAINT "perfiles_maestro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactos_maestro" ADD CONSTRAINT "contactos_maestro_maestro_id_fkey" FOREIGN KEY ("maestro_id") REFERENCES "perfiles_maestro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "info_medica_maestro" ADD CONSTRAINT "info_medica_maestro_maestro_id_fkey" FOREIGN KEY ("maestro_id") REFERENCES "perfiles_maestro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles_administrativo" ADD CONSTRAINT "perfiles_administrativo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactos_administrativo" ADD CONSTRAINT "contactos_administrativo_administrativo_id_fkey" FOREIGN KEY ("administrativo_id") REFERENCES "perfiles_administrativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "info_medica_administrativo" ADD CONSTRAINT "info_medica_administrativo_administrativo_id_fkey" FOREIGN KEY ("administrativo_id") REFERENCES "perfiles_administrativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_servicios" ADD CONSTRAINT "personal_servicios_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactos_personal_servicios" ADD CONSTRAINT "contactos_personal_servicios_personal_servicios_id_fkey" FOREIGN KEY ("personal_servicios_id") REFERENCES "personal_servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "info_medica_personal_servicios" ADD CONSTRAINT "info_medica_personal_servicios_personal_servicios_id_fkey" FOREIGN KEY ("personal_servicios_id") REFERENCES "personal_servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_auditoria" ADD CONSTRAINT "registro_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_auditoria" ADD CONSTRAINT "registro_auditoria_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permisos_administrativo" ADD CONSTRAINT "permisos_administrativo_administrativo_id_fkey" FOREIGN KEY ("administrativo_id") REFERENCES "perfiles_administrativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permisos_administrativo" ADD CONSTRAINT "permisos_administrativo_seccion_id_fkey" FOREIGN KEY ("seccion_id") REFERENCES "secciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
