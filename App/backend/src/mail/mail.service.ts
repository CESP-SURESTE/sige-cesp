import { Inject, Injectable, Optional } from '@nestjs/common';

/**
 * `MailService` — Fase 4, Día 13 (desbloqueado 2026-08-17).
 *
 * Cliente mínimo de Mailgun: `POST /v3/{domain}/messages` vía `fetch` nativo
 * (Node 18+) — sin SDK (`mailgun.js`/`form-data`), no hace falta para un solo
 * endpoint tipo formulario. Basic Auth con `api:${MAILGUN_API_KEY}` en
 * base64, body `application/x-www-form-urlencoded` (`URLSearchParams`).
 *
 * El dominio de hoy es un SANDBOX de Mailgun (cliente aún no resolvió el
 * dominio real de CESP) — Mailgun rechaza destinatarios no autorizados
 * manualmente en su dashboard, así que la mayoría de los envíos van a
 * fallar en la práctica hasta que haya dominio real. Migrar a dominio real
 * es solo cambiar `MAILGUN_DOMAIN`/`MAILGUN_BASE_URL` en `.env`, sin tocar
 * este archivo.
 *
 * Este service SIEMPRE lanza si Mailgun rechaza o si la red falla — es
 * responsabilidad del CALLER (`PersonasService.altaPersona`) decidir que el
 * envío es best-effort y envolver la llamada en su propio try/catch sin
 * dejar que un fallo de correo tumbe el alta de la persona. Ese try/catch
 * NO vive acá para que el comportamiento (loguear + tragar el error) sea
 * explícito y testeable en el caller, en vez de un `MailService` que traga
 * errores en silencio.
 *
 * `MAILGUN_ENVIOS_HABILITADO` — pedido explícito del usuario 2026-08-17,
 * mismo criterio que `POLITICA_PASSWORD_HABILITADA`
 * (`src/auth/password-policy.ts`): un flag simple, apagado por defecto, para
 * no gastar la capa gratuita de Mailgun mientras se prueba/desarrolla. A
 * diferencia de `POLITICA_PASSWORD_HABILITADA` (constante hardcodeada en
 * código, cambia con un deploy) este flag es una env var
 * (`MAILGUN_ENVIOS_HABILITADO` en `.env`, string `"true"`/`"false"`) — se
 * prende/apaga sin tocar código, más apropiado acá porque es un interruptor
 * de "modo desarrollo/QA" que puede necesitar cambiar sin un redeploy.
 * FALLA CERRADO: cualquier valor que no sea exactamente `"true"` (incluida
 * la ausencia de la env var, o un typo) se trata como `false` — no enviar
 * por accidente es el error seguro, enviar por accidente contra el sandbox
 * de Mailgun gasta cuota real. Con el flag apagado, `enviarCorreoBienvenida`
 * NO hace la petición HTTP: loguea y retorna como no-op exitoso (no es un
 * error, es un skip intencional) — el resto del flujo de alta
 * (`PersonasService.altaPersona`) queda exactamente igual, sigue
 * devolviendo `temporaryPassword` sin depender de esto. Para probar envíos
 * reales en local: setear `MAILGUN_ENVIOS_HABILITADO=true` en `.env`.
 */

export const MAIL_FETCH_OVERRIDE = 'MAIL_FETCH_OVERRIDE';

function enviosHabilitados(): boolean {
  return process.env.MAILGUN_ENVIOS_HABILITADO === 'true';
}

export interface EnviarCorreoBienvenidaParams {
  nombreCompleto: string;
  /**
   * Login de acceso (`Usuario.email`) — se muestra DENTRO del cuerpo del
   * correo ("Email de acceso: ..."), NO es necesariamente el destino real
   * del envío. Desde que el login pasó a ser sintético para los 3 roles
   * (feature 2026-08-18, `PersonasService.generarLoginAlumno`/
   * `generarLoginPersonal` — el login ya no tiene buzón real), la persona
   * necesita ver este valor como TEXTO para saber con qué iniciar sesión,
   * aunque el correo mismo no llegue a esa dirección.
   */
  email: string;
  /**
   * Destino REAL del envío (feature 2026-08-18) — a dónde Mailgun manda el
   * mensaje de verdad (`to:`). Antes de este cambio no existía este campo
   * separado: el correo se mandaba al mismo `email` de arriba (cuando el
   * login todavía podía ser un correo real capturado por el admin). Ahora
   * SIEMPRE es `correoPersonal` del perfil (alumno/maestro/administrativo)
   * — el único correo legible por un humano, para los 3 roles por igual.
   */
  correoDestino: string;
  temporaryPassword: string;
}

export interface EnviarCorreoReseteoPasswordParams {
  nombreCompleto: string;
  /** Destino real (`to:`) — SIEMPRE `correoPersonal` del perfil, nunca `Usuario.email`. */
  correoDestino: string;
  /** Link de recuperación generado por `client.auth.admin.generateLink({ type: 'recovery' })`. */
  linkReseteo: string;
}

export interface EnviarNotificacionParams {
  /** Destino real del envío (`to:`). Normalmente `correoPersonal` del perfil. */
  correoDestino: string;
  asunto: string;
  cuerpoTexto: string;
  /** Opcional — si falta, se manda solo `text`. */
  cuerpoHtml?: string;
}

@Injectable()
export class MailService {
  constructor(
    @Optional()
    @Inject(MAIL_FETCH_OVERRIDE)
    private readonly fetchOverride?: typeof fetch,
  ) {}

  private getFetch(): typeof fetch {
    return this.fetchOverride ?? fetch;
  }

  private buildTexto(
    params: EnviarCorreoBienvenidaParams,
    loginUrl: string,
  ): string {
    const { nombreCompleto, email, temporaryPassword } = params;
    return [
      `Hola ${nombreCompleto},`,
      '',
      'Se creó una cuenta nueva para ti en SIGE (Sistema de Gestión Escolar de CESP).',
      '',
      `Email de acceso: ${email}`,
      `Contraseña temporal: ${temporaryPassword}`,
      '',
      `Ingresa aquí: ${loginUrl}`,
      '',
      'Por seguridad, se te pedirá cambiar esta contraseña la primera vez que ingreses.',
      '',
      'SIGE CESP',
    ].join('\n');
  }

  private buildHtml(
    params: EnviarCorreoBienvenidaParams,
    loginUrl: string,
  ): string {
    const { nombreCompleto, email, temporaryPassword } = params;
    return `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1f2937;">
        <p>Hola <strong>${nombreCompleto}</strong>,</p>
        <p>Se creó una cuenta nueva para ti en SIGE (Sistema de Gestión Escolar de CESP).</p>
        <p>
          <strong>Email de acceso:</strong> ${email}<br />
          <strong>Contraseña temporal:</strong> ${temporaryPassword}
        </p>
        <p><a href="${loginUrl}">${loginUrl}</a></p>
        <p>Por seguridad, se te pedirá cambiar esta contraseña la primera vez que ingreses.</p>
        <p>SIGE CESP</p>
      </div>
    `.trim();
  }

  private buildTextoReseteo(params: EnviarCorreoReseteoPasswordParams): string {
    const { nombreCompleto, linkReseteo } = params;
    return [
      `Hola ${nombreCompleto},`,
      '',
      'Un administrativo de SIGE (Sistema de Gestión Escolar de CESP) solicitó restablecer tu contraseña.',
      '',
      `Da clic aquí para elegir una contraseña nueva: ${linkReseteo}`,
      '',
      'Si tú no solicitaste esto, ignora este correo — tu contraseña actual sigue siendo válida — y repórtalo a tu administrativo a cargo lo antes posible, ya que podría tratarse de un fraude o un mal uso de tu cuenta.',
      '',
      'SIGE CESP',
    ].join('\n');
  }

  private buildHtmlReseteo(params: EnviarCorreoReseteoPasswordParams): string {
    const { nombreCompleto, linkReseteo } = params;
    return `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1f2937;">
        <p>Hola <strong>${nombreCompleto}</strong>,</p>
        <p>Un administrativo de SIGE (Sistema de Gestión Escolar de CESP) solicitó restablecer tu contraseña.</p>
        <p><a href="${linkReseteo}">Da clic aquí para elegir una contraseña nueva</a></p>
        <p>Si tú no solicitaste esto, ignora este correo — tu contraseña actual sigue siendo válida — y repórtalo a tu administrativo a cargo lo antes posible, ya que podría tratarse de un fraude o un mal uso de tu cuenta.</p>
        <p>SIGE CESP</p>
      </div>
    `.trim();
  }

  /**
   * Helper privado — realiza la petición real a Mailgun (config, auth, fetch, error handling).
   * Asume que `MAILGUN_ENVIOS_HABILITADO` ya fue verificado por el caller.
   * Lanza si falta config, si la red falla, o si Mailgun rechaza.
   */
  private async enviarCorreoAMailgun(
    correoDestino: string,
    asunto: string,
    cuerpoTexto: string,
    cuerpoHtml?: string,
  ): Promise<void> {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;
    const baseUrl = process.env.MAILGUN_BASE_URL ?? 'https://api.mailgun.net';

    if (!apiKey || !domain) {
      throw new Error('Falta MAILGUN_API_KEY o MAILGUN_DOMAIN en el entorno');
    }

    const body = new URLSearchParams({
      from: `SIGE CESP <postmaster@${domain}>`,
      to: correoDestino,
      subject: asunto,
      text: cuerpoTexto,
      ...(cuerpoHtml ? { html: cuerpoHtml } : {}),
    });

    const auth = Buffer.from(`api:${apiKey}`).toString('base64');
    const clientFetch = this.getFetch();
    const response = await clientFetch(`${baseUrl}/v3/${domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const detalle = await response.text().catch(() => '');
      throw new Error(
        `Mailgun respondió ${response.status} ${response.statusText}: ${detalle}`,
      );
    }
  }

  /**
   * Envía el correo de bienvenida a una persona recién dada de alta.
   * Lanza si `MAILGUN_API_KEY`/`MAILGUN_DOMAIN` faltan, si Mailgun responde
   * con un status no-2xx, o si `fetch` rechaza (red) — el caller decide qué
   * hacer con eso (ver comentario de la clase).
   *
   * Con `MAILGUN_ENVIOS_HABILITADO` apagado (default), no llega a armar ni
   * mandar la petición — retorna de inmediato como no-op exitoso (ver
   * comentario del flag arriba).
   */
  async enviarCorreoBienvenida(
    params: EnviarCorreoBienvenidaParams,
  ): Promise<void> {
    if (!enviosHabilitados()) {
      console.log(
        '[MailService] Envío deshabilitado (MAILGUN_ENVIOS_HABILITADO=false) — se hubiera enviado a:',
        params.correoDestino,
      );
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const loginUrl = `${frontendUrl}/login`;

    await this.enviarCorreoAMailgun(
      params.correoDestino,
      'Bienvenido a SIGE — tu cuenta ya está lista',
      this.buildTexto(params, loginUrl),
      this.buildHtml(params, loginUrl),
    );
  }

  /**
   * A diferencia de `enviarCorreoBienvenida`/`enviarNotificacion`, el CALLER
   * (`PersonasService.resetearPassword`) NO envuelve esta llamada en un
   * try/catch silencioso — el correo es el único mecanismo de entrega del
   * link, así que un fallo de Mailgun debe propagarse como error real, no
   * tragarse como best-effort.
   *
   * A diferencia del resto de los métodos de esta clase, el flag
   * `MAILGUN_ENVIOS_HABILITADO` apagado NO es un no-op silencioso aquí — este
   * correo es el ÚNICO canal de entrega del link de recuperación (no hay
   * `temporaryPassword` de respaldo mostrado en pantalla, como sí tiene
   * `enviarCorreoBienvenida`); reportar éxito sin haber enviado nada
   * contradice la restricción explícita del plan ("el correo de reseteo no
   * es best-effort silencioso"). Por eso LANZA en vez de loguear+retornar,
   * para que `PersonasService.resetearPassword` lo propague igual que
   * cualquier otro fallo real de Mailgun (→ 500 SERVER_ERROR).
   */
  async enviarCorreoReseteoPassword(
    params: EnviarCorreoReseteoPasswordParams,
  ): Promise<void> {
    if (!enviosHabilitados()) {
      throw new Error(
        'Envío de correo deshabilitado (MAILGUN_ENVIOS_HABILITADO=false) — no se puede completar el reseteo de contraseña sin enviar el enlace',
      );
    }

    await this.enviarCorreoAMailgun(
      params.correoDestino,
      'Restablece tu contraseña — SIGE CESP',
      this.buildTextoReseteo(params),
      this.buildHtmlReseteo(params),
    );
  }

  /**
   * Envío genérico de notificación por correo — Fase 14, Día 38. Lo usan el
   * fan-out de avisos (Fase 16) y el job de recordatorios (Fase 15) como
   * efecto best-effort: el CALLER envuelve en su propio try/catch y no deja
   * que un fallo de Mailgun tumbe la operación (mismo criterio que
   * `enviarCorreoBienvenida` + `PersonasService.altaPersona`).
   *
   * Mismo comportamiento del flag `MAILGUN_ENVIOS_HABILITADO` (falla cerrado):
   * apagado -> loguea y retorna sin pegarle a Mailgun.
   */
  async enviarNotificacion(params: EnviarNotificacionParams): Promise<void> {
    if (!enviosHabilitados()) {
      console.log(
        '[MailService] Envío deshabilitado (MAILGUN_ENVIOS_HABILITADO=false) — se hubiera enviado a:',
        params.correoDestino,
      );
      return;
    }

    await this.enviarCorreoAMailgun(
      params.correoDestino,
      params.asunto,
      params.cuerpoTexto,
      params.cuerpoHtml,
    );
  }
}
