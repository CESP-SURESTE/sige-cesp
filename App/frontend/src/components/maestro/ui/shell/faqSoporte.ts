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
    id: 'perfil',
    titulo: 'Mi perfil',
    preguntas: [
      {
        pregunta: '¿Cómo cambio mi contraseña?',
        respuesta:
          'La contraseña temporal se cambia en tu primer ingreso. Si después necesitas una nueva, pide a un administrativo de tu sede que te restablezca la contraseña.',
      },
      {
        pregunta: '¿Cómo subo o cambio mi foto de perfil?',
        respuesta:
          'Desde "Mi perfil" (menú de tu cuenta), haz clic en tu foto o avatar (dice "Cambiar"). Acepta JPG, PNG o WEBP, hasta 3MB.',
      },
      {
        pregunta: 'Olvidé mi contraseña, ¿qué hago?',
        respuesta:
          'Pide a un administrativo de tu sede que te restablezca la contraseña desde el listado de maestros — te llegará un correo con el enlace para elegir una nueva.',
      },
    ],
  },
  {
    id: 'grupos',
    titulo: 'Mis grupos y materias',
    preguntas: [
      {
        pregunta: '¿Dónde veo los grupos y materias que tengo asignados?',
        respuesta:
          'En tu perfil, en la sección "Mis grupos y materias" verás cada grupo con las materias que impartes en él.',
      },
      {
        pregunta: 'No veo un grupo que debería tener asignado',
        respuesta:
          'La asignación de materias a un maestro la hace un administrativo desde el detalle del grupo. Pide que revisen tu asignación ahí.',
      },
    ],
  },
  {
    id: 'avisos-calendario',
    titulo: 'Avisos y calendario',
    preguntas: [
      {
        pregunta: '¿Cómo publico un aviso para mi grupo?',
        respuesta:
          'Ve a "Avisos", pestaña "Publicados", y usa el botón "+ Nuevo aviso". Como maestro solo puedes publicar avisos dirigidos a un grupo donde des clase.',
      },
      {
        pregunta: '¿Cómo agrego un evento al calendario de mi grupo?',
        respuesta:
          'Ve a "Calendario" y crea un evento nuevo con alcance "Grupo", eligiendo uno de los grupos donde impartes materia.',
      },
    ],
  },
];
