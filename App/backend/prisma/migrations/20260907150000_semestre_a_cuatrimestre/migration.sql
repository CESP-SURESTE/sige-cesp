-- Rename real column (NOT drop+add): preserves existing student data.
-- `prisma migrate diff` generated a DROP COLUMN + ADD COLUMN for this change
-- (it diffs structure, not renames semantically) — rewritten by hand per
-- docs/superpowers/plans/2026-09-07-semestre-a-cuatrimestre.md (Decisión 2).
ALTER TABLE "perfiles_alumno" RENAME COLUMN "semestre_actual" TO "cuatrimestre_actual";
