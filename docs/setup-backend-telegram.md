# Setup — Bot de Telegram para reportes de bugs

El "Bot de soporte" de SIGE avisa por Telegram cuando un administrativo o
maestro reporta un bug (`POST /soporte/reportes`). Requiere un bot de
Telegram propio y 2 variables de entorno en `App/backend/.env`.

## 1. Crear el bot

1. Abre Telegram y busca `@BotFather`.
2. Manda `/newbot`, sigue las instrucciones (nombre + username terminado en
   `bot`).
3. BotFather responde con un token con forma
   `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` — esto es
   `TELEGRAM_BOT_TOKEN`.

## 2. Obtener tu `chat_id`

1. Busca tu bot nuevo en Telegram (por su username) y mándale cualquier
   mensaje (ej. "hola") para iniciar la conversación.
2. Abre en el navegador:
   `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
3. Busca `"chat":{"id":` en la respuesta JSON — ese número es
   `TELEGRAM_CHAT_ID`.

## 3. Configurar el backend

En `App/backend/.env`:

```
TELEGRAM_BOT_TOKEN=123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=987654321
```

Sin estas 2 variables, `TelegramService` lanza al primer intento de envío
— el reporte de bug igual se guarda en la DB (best-effort), solo no llega
el aviso a Telegram. No hay flag de "envíos habilitados" separado — el
toggle de `app/plataforma/soporte/` (`ConfiguracionSoporte.activo`) ya
controla si se llega a intentar el envío.
