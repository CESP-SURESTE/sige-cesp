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
          'Ve a "Alumnos" en el menú lateral y usa el botón "Dar de alta un alumno". El sistema genera la matrícula y la contraseña temporal automáticamente.',
      },
      {
        pregunta: '¿Cómo corrijo un dato mal capturado de una persona?',
        respuesta:
          'En el listado (Alumnos/Maestros/Administrativos), usa el ícono de lápiz de su fila. La matrícula y el usuario de acceso no se pueden modificar.',
      },
      {
        pregunta: '¿Cómo cambio la contraseña de alguien que la olvidó?',
        respuesta:
          'En el listado de la persona (Alumnos/Maestros/Administrativos), usa el botón "Restablecer contraseña" de su fila. Le llega un correo con el enlace para elegir una nueva.',
      },
      {
        pregunta: '¿Cómo doy de baja a un maestro o administrativo?',
        respuesta:
          'Desde su listado, usa "Cambiar estatus" en su fila, elige "Baja" y y elige el motivo. Dependiendo del motivo, esto también revoca su acceso al sistema.',
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
          'En "Grupos", usa el enlace "Alumnos" de la fila del grupo para abrir su detalle. Ahí, en la sección de materias, elige al maestro en la fila de la materia y presiona "Agregar". Si la materia no existe, créala con "+ Nueva materia".',
      },
    ],
  },
  {
    id: 'carreras',
    titulo: 'Carreras',
    preguntas: [
      {
        pregunta: '¿Cómo agrego una carrera nueva?',
        respuesta:
          'Ve a "Carreras" en el menú lateral y usa el botón "+ Nueva carrera". Necesitas indicar nombre, clave única, nivel (Técnico/Licenciatura/Maestría/Doctorado), modalidad, duración en cuatrimestres y una descripción. El RVOE es opcional — si no es de Yucatán, puedes anotar de qué estado es en "Procedencia del RVOE".',
      },
      {
        pregunta: '¿Cómo edito una carrera que ya existe?',
        respuesta:
          'Desde el listado de "Carreras", usa el botón "Editar" de la fila de la carrera; se abre el mismo formulario de alta, ya con sus datos precargados.',
      },
      {
        pregunta: '¿Cómo subo la malla curricular de una carrera?',
        respuesta:
          'Entra a "Carreras" y usa el botón "Subir malla" de la fila de la carrera para subir el PDF. Cada vez que subes uno nuevo, reemplaza al anterior.',
      },
    ],
  },
  {
    id: 'avisos',
    titulo: 'Avisos',
    preguntas: [
      {
        pregunta: '¿Cómo publico un aviso?',
        respuesta:
          'Ve a "Avisos", pestaña "Publicados", y usa el botón "+ Nuevo aviso". Escribe un título y el cuerpo del mensaje, y elige a quién va dirigido: toda la sede, una carrera específica o un grupo específico.',
      },
      {
        pregunta: '¿Quién puede ver los avisos que publico?',
        respuesta:
          'Solo las personas dentro del alcance que elegiste (toda la sede, esa carrera o ese grupo) — les llega como notificación y aparece en su pestaña "Recibidos".',
      },
      {
        pregunta: '¿Puedo ver quién ya leyó un aviso?',
        respuesta:
          'Sí. En la pestaña "Publicados", usa "Ver recibos" en la fila del aviso — te dice cuántos lo han leído y cuántos no, y quiénes son.',
      },
      {
        pregunta: '¿Puedo borrar un aviso que publiqué?',
        respuesta:
          'Sí. En la pestaña "Publicados", usa "Eliminar" en su fila. Solo tú (como autor) o cualquier administrativo de tu sede pueden eliminarlo.',
      },
    ],
  },
  {
    id: 'emergencia',
    titulo: 'Botón de Emergencia',
    preguntas: [
      {
        pregunta: '¿Qué es la sección de Emergencia?',
        respuesta:
          'Es una pantalla especial ("Emergencia" en el menú lateral) pensada para actuar rápido ante una urgencia médica o de seguridad: te deja buscar a cualquier persona de tu sede y ver de inmediato su expediente médico y sus contactos de emergencia.',
      },
      {
        pregunta: '¿Cómo busco a una persona en una emergencia?',
        respuesta:
          'En la sección "Emergencia" usa el buscador — puedes escribir nombre, apellido, matrícula (alumnos) o cédula (maestros). Busca entre alumnos, maestros, administrativos y personal de servicios de tu sede al mismo tiempo.',
      },
      {
        pregunta: '¿Qué información veo en el expediente de emergencia?',
        respuesta:
          'Nombre completo, CURP, teléfono, correo personal, tipo de sangre, si tiene alguna condición médica (padecimientos, medicamentos, alergias) y sus contactos de emergencia con teléfono y parentesco.',
      },
      {
        pregunta:
          '¿Cómo agrego o edito los teléfonos de emergencia de mi sede?',
        respuesta:
          'En la misma sección "Emergencia" hay un apartado para gestionar los teléfonos de emergencia de la sede (bomberos, Cruz Roja, protección civil, etc.) — puedes agregar, editar o eliminar los que necesites.',
      },
    ],
  },
];
