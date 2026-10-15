import { EstatusReporteBug } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class CambiarEstatusReporteBugDto {
  @IsEnum(EstatusReporteBug, { message: 'estatus inválido' })
  estatus!: EstatusReporteBug;
}
