import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  obtenerEstado(): { status: string } {
    return { status: 'ok' };
  }
}
