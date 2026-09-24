import { Inject, Injectable, Optional } from '@nestjs/common';

/**
 * `TelegramService` — feature "Bot de soporte" (2026-09-24).
 *
 * Cliente mínimo de la Bot API de Telegram vía `fetch` nativo — mismo
 * criterio que `MailService`: sin SDK, un solo uso no lo amerita.
 *
 * Best-effort SIEMPRE desde el punto de vista del CALLER
 * (`SoporteService.crearReporte`): este service lanza si falta config o si
 * Telegram rechaza/la red falla, y es responsabilidad del caller envolver
 * la llamada en su propio try/catch sin dejar que un fallo de Telegram
 * tumbe el reporte ya guardado — mismo patrón que
 * `MailService.enviarNotificacion` + `PersonasService.altaPersona`.
 *
 * A diferencia de `MailService`, no hay un flag tipo
 * `MAILGUN_ENVIOS_HABILITADO` — el toggle `ConfiguracionSoporte.activo` ya
 * cumple ese rol un nivel arriba (`SoporteService.crearReporte` nunca llega
 * a llamar este service si el bot está desactivado).
 */
export const TELEGRAM_FETCH_OVERRIDE = 'TELEGRAM_FETCH_OVERRIDE';

export interface EnviarReporteBugParams {
  descripcion: string;
  nombreReportante: string;
  sedeNombre: string;
  /** URL firmada (signed URL) ya lista para que Telegram la descargue directo — el backend nunca sube el binario. */
  capturaUrl?: string | null;
}

/** Límite real de la Bot API para `caption` en `sendPhoto`. */
const LIMITE_CAPTION_TELEGRAM = 1024;

function truncar(texto: string, limite: number): string {
  return texto.length > limite ? `${texto.slice(0, limite - 3)}...` : texto;
}

@Injectable()
export class TelegramService {
  constructor(
    @Optional()
    @Inject(TELEGRAM_FETCH_OVERRIDE)
    private readonly fetchOverride?: typeof fetch,
  ) {}

  private getFetch(): typeof fetch {
    return this.fetchOverride ?? fetch;
  }

  private construirTexto(params: EnviarReporteBugParams): string {
    return [
      '🐛 Nuevo reporte de bug — SIGE',
      '',
      `Sede: ${params.sedeNombre}`,
      `Reportado por: ${params.nombreReportante}`,
      '',
      params.descripcion,
    ].join('\n');
  }

  /**
   * Envía el aviso de un reporte de bug — `sendPhoto` (con caption) si trae
   * `capturaUrl`, `sendMessage` (solo texto) si no. Lanza si falta
   * `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, si Telegram responde no-2xx, o
   * si `fetch` rechaza (red) — ver comentario de la clase.
   */
  async enviarReporteBug(params: EnviarReporteBugParams): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      throw new Error(
        'Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en el entorno',
      );
    }

    const texto = this.construirTexto(params);
    const endpoint = params.capturaUrl ? 'sendPhoto' : 'sendMessage';
    const body = params.capturaUrl
      ? {
          chat_id: chatId,
          photo: params.capturaUrl,
          caption: truncar(texto, LIMITE_CAPTION_TELEGRAM),
        }
      : { chat_id: chatId, text: texto };

    const clientFetch = this.getFetch();
    const response = await clientFetch(
      `https://api.telegram.org/bot${token}/${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const detalle = await response.text().catch(() => '');
      throw new Error(
        `Telegram respondió ${response.status} ${response.statusText}: ${detalle}`,
      );
    }
  }
}
