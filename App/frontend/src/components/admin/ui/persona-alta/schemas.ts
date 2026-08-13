import { z } from 'zod';

/**
 * Fragmentos de validación de "contactos de emergencia" + "datos de salud" —
 * compartidos por los 3 `zodSchema` de `app/admin/{alumnos,maestros,
 * administrativos}/nuevo/page.tsx` (extensión de `POST /personas`, decisión
 * del usuario 2026-08-12: misma transacción que el alta). Espejo de
 * `ContactoDto`/`ContactoAlumnoDto`/`InfoMedicaDto`
 * (`App/backend/src/personas/dto/crear-persona.dto.ts`) — solo UX, la
 * validación real vive en el backend.
 */
export const contactoBaseSchema = z.object({
  nombre: z.string().min(1, 'El nombre del contacto es requerido'),
  telefono: z.string().min(1, 'El teléfono del contacto es requerido'),
  correo: z
    .union([z.literal(''), z.string().email('Formato de correo inválido')])
    .optional(),
  parentesco: z.string().min(1, 'El parentesco es requerido'),
});

export const contactoAlumnoSchema = contactoBaseSchema.extend({
  tipo: z.enum(['TUTOR', 'EMERGENCIA'], {
    message: 'Selecciona el tipo de contacto',
  }),
});

export const contactosSchema = z
  .array(contactoBaseSchema)
  .min(1, 'Agrega al menos 1 contacto de emergencia')
  .max(3, 'Máximo 3 contactos de emergencia');

export const contactosAlumnoSchema = z
  .array(contactoAlumnoSchema)
  .min(1, 'Agrega al menos 1 contacto de emergencia')
  .max(3, 'Máximo 3 contactos de emergencia');

export const infoMedicaSchema = z.object({
  tieneCondicionMedica: z.boolean(),
  padecimiento: z.string().optional(),
  medicamentos: z.string().optional(),
  alergias: z.string().optional(),
  tratamientoAdicional: z.string().optional(),
});
