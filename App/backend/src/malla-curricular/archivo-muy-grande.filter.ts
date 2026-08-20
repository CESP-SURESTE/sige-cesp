import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * `FileInterceptor` (multer) rechaza archivos que exceden el límite DENTRO
 * del propio multer, antes de que el controller/service corran — Nest
 * mapea eso a `PayloadTooLargeException`, que sin este filter escapa al
 * contrato `{ error, code }` de la API (responde `{ statusCode, message,
 * error }` genérico de Nest, sin `code`, sin loguear). Filter local, no
 * global — solo aplica a este endpoint (`@UseFilters` en el controller).
 */
@Catch(PayloadTooLargeException)
export class ArchivoMuyGrandeFilter implements ExceptionFilter {
  catch(exception: PayloadTooLargeException, host: ArgumentsHost): void {
    console.error(
      '[MallaCurricularController] archivo excede el límite de 5MB:',
      exception.message,
    );
    const response = host.switchToHttp().getResponse<Response>();
    response.status(400).json({
      error: 'El archivo no puede pesar más de 5MB',
      code: 'VALIDATION_ERROR',
    });
  }
}
