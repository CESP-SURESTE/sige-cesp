export interface PreguntaFaq {
  pregunta: string;
  respuesta: string;
}

export interface CategoriaFaq {
  id: string;
  titulo: string;
  preguntas: PreguntaFaq[];
}

export const CATEGORIAS_FAQ_SOPORTE: CategoriaFaq[] = [
  {
    id: 'personas',
    titulo: 'Alumnos, maestros y administrativos',
    preguntas: [
      {
        pregunta: '¿Cómo doy de alta a un alumno?',
        respuesta:
          'Ve a "Alumnos" en el menú lateral y usa el botón "+ Nuevo alumno". El sistema genera la matrícula y la contraseña temporal automáticamente.',
      },
      {
        pregunta: '¿Cómo cambio la contraseña de alguien que la olvidó?',
        respuesta:
          'En el listado de la persona (Alumnos/Maestros/Administrativos), usa el botón "Restablecer contraseña" de su fila. Le llega un correo con el enlace para elegir una nueva.',
      },
      {
        pregunta: '¿Cómo doy de baja a un maestro o administrativo?',
        respuesta:
          'Desde su listado, cambia su estatus a "Baja" y elige el motivo. Dependiendo del motivo, esto también revoca su acceso al sistema.',
      },
    ],
  },
  {
    id: 'grupos',
    titulo: 'Grupos y materias',
    preguntas: [
      {
        pregunta: '¿Cómo creo un grupo nuevo?',
        respuesta:
          'Ve a "Grupos" y usa el botón "+ Nuevo grupo". Necesitas tener ya creados la carrera y el salón donde va a estar.',
      },
      {
        pregunta: '¿Cómo asigno un maestro a una materia?',
        respuesta:
          'Entra al detalle del grupo (clic en la fila) y usa la sección de materias asignadas para agregar al maestro correspondiente.',
      },
    ],
  },
  {
    id: 'otros',
    titulo: 'Otros',
    preguntas: [
      {
        pregunta: '¿Cómo subo la malla curricular de una carrera?',
        respuesta:
          'Entra a "Carreras", edita la carrera y usa la sección de malla curricular para subir el PDF.',
      },
    ],
  },
];
