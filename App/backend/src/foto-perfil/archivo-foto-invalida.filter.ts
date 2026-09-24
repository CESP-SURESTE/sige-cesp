import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Mismo problema/solución que `malla-curricular/archivo-muy-grande.filter.ts`
 * (`FileInterceptor` rechaza el archivo DENTRO de multer con
 * `PayloadTooLargeException`, que sin este filter escapa al contrato
 * `{ error, code }`) — copia local con el límite/mensaje de foto (3MB), no
 * se comparte con malla-curricular (mensajes distintos, y este proyecto
 * prefiere una copia chica por dominio a una generalización prematura con
 * un solo caso más — mismo criterio que `SubirMallaModal.tsx`).
 */
@Catch(PayloadTooLargeException)
export class ArchivoFotoInvalidaFilter implements ExceptionFilter {
  catch(exception: PayloadTooLargeException, host: ArgumentsHost): void {
    console.error(
      '[FotoPerfil] archivo excede el límite de 3MB:',
      exception.message,
    );
    const response = host.switchToHttp().getResponse<Response>();
    response.status(400).json({
      error: 'La foto no puede pesar más de 3MB',
      code: 'VALIDATION_ERROR',
    });
  }
}
