import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Wrapper de NestJS sobre `PrismaClient`. Se conecta con el rol `postgres`
 * (vía `DATABASE_URL`, connection pooler) — ese rol tiene `BYPASSRLS`, así
 * que todas las queries hechas a través de este servicio ignoran las RLS
 * policies (Fase 1, Día 5). El aislamiento por sede para las queries del
 * backend depende del `SedeGuard` (Día 6), NO de RLS — ver nota en
 * `prisma/migrations/20260806224102_rls_multisede/migration.sql`.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
