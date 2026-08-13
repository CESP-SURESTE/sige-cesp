/** Mensaje de error de un campo de formulario — mismo componente para los 3 formularios de alta (Día 15). */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-crimson">{message}</p>;
}
