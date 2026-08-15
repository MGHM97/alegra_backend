---
name: migrations-baseline
description: Baseline de prisma migrate feito em 15/08/2026 — banco local nunca teve _prisma_migrations até então
metadata:
  type: project
---

Até 15/08/2026 o banco local (e presumivelmente todo ambiente) foi criado e
evoluído só via `prisma db push`, mesmo já existindo SQL em
`prisma/migrations/` (nunca aplicado pelo Prisma Migrate, `_prisma_migrations`
não existia). Nesta data, sem rodar nenhum SQL, cada pasta foi marcada como
aplicada na ordem cronológica com `prisma migrate resolve --applied <nome>`:
`0_init`, `20260613000000_add_seasonal_campaigns`,
`20260613000001_add_product_video_url`,
`20260815000000_add_user_stripe_customer_id`, `20260815010000_perf_indexes`.
`yarn prisma migrate status` agora diz "Database schema is up to date!", sem
drift.

**Por quê:** a migration `perf_indexes` cria
`orders_status_created_at_idx ... INCLUDE ("total_amount")`, cláusula que o
`schema.prisma` (`@@index`) não consegue expressar. Um `db push` depois
desse ponto recriaria esse índice SEM o `INCLUDE`, silenciosamente perdendo
Index Only Scan nos agregados de `GET /v1/admin/metrics` — sem erro, sem
aviso, só regressão de performance sob carga.

**Como aplicar:** ver `docs/migrations.md` no repo (procedimento completo,
inclusive para produção/staging que também só tiveram `db push` até agora).

**Regra daqui pra frente:** nunca mais `prisma db push` (nem os scripts
`yarn migrate` / `yarn prisma:push`, que chamam `db push` por baixo — não
usar em ambientes já baseline-ados). Fluxo correto: `prisma migrate dev
--name <nome>` (gera + aplica local, revisar o SQL gerado pra
adicionar `INCLUDE`/cláusulas fora do DSL manualmente quando necessário) +
`prisma migrate deploy` em staging/produção.
