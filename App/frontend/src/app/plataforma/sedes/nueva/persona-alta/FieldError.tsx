// Duplicado deliberado de `components/admin/ui/persona-alta/FieldError.tsx`
// (regla 11 de CLAUDE.md raíz — app/plataforma/ no importa de app/admin/).
// Mantener en sync a mano si el original cambia.

/** Mensaje de error de un campo de formulario — mismo componente para los 3 formularios de alta (Día 15). */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-crimson">{message}</p>;
}
