# Disparador del job de recordatorios (`pg_cron` + `pg_net`)

Este documento es para configurar manualmente en el SQL Editor de Supabase — no es
código que se despliega, es una tarea de infraestructura fuera del ciclo normal de
review de código. Requiere que el backend ya esté desplegado (dev o prod) con
`INTERNAL_JOB_SECRET` configurado en las env vars del hosting.

## 1. Habilitar las extensiones (una sola vez por proyecto de Supabase)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

## 2. Programar el cron diario

Reemplaza `<URL_DEL_BACKEND>` por la URL real del backend desplegado (ej.
`https://sige-cesp-backend.onrender.com`) y `<INTERNAL_JOB_SECRET>` por el valor real
configurado en las env vars del backend (NUNCA lo pegues en un commit ni en un chat):

```sql
select cron.schedule(
  'recordatorios-calendario-diario',
  '0 7 * * *',  -- 07:00 UTC todos los días — ajustar a la hora que se quiera
  $$
  select net.http_post(
    url := '<URL_DEL_BACKEND>/internal/recordatorios/ejecutar',
    headers := jsonb_build_object('X-Internal-Secret', '<INTERNAL_JOB_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
```

## 3. Verificar que corrió

```sql
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'recordatorios-calendario-diario')
order by start_time desc
limit 5;
```

## 4. Desactivar/eliminar

```sql
select cron.unschedule('recordatorios-calendario-diario');
```

## Alternativa equivalente

Si se prefiere no depender de `pg_cron`, una GitHub Action con `schedule` que haga un
`curl -X POST <URL_DEL_BACKEND>/internal/recordatorios/ejecutar -H "X-Internal-Secret:
..."` diario cumple la misma función, sin tocar la DB de Supabase. Elegir una u otra, no
ambas (evita duplicar notificaciones — aunque el job es idempotente por `RecordatorioEnviado`,
correrlo 2 veces es trabajo de más sin beneficio).
