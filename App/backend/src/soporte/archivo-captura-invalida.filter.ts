import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch(PayloadTooLargeException)
export class ArchivoCapturaInvalidaFilter implements ExceptionFilter {
  catch(exception: PayloadTooLargeException, host: ArgumentsHost): void {
    console.error(
      '[SoporteController] captura excede el límite de 3MB:',
      exception.message,
    );
    const response = host.switchToHttp().getResponse<Response>();
    response.status(400).json({
      error: 'La captura no puede pesar más de 3MB',
      code: 'VALIDATION_ERROR',
    });
  }
}
