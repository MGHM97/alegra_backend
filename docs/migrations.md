# Migrations — histórico e baseline

## Contexto

O banco local (e todos os ambientes até 15/08/2026) foi sempre criado e
evoluído via `prisma db push`, nunca via `prisma migrate dev`. Isso significa
que a tabela de controle `_prisma_migrations` nunca existiu, mesmo com a
pasta `prisma/migrations/` já contendo histórico SQL gerado manualmente
(usado apenas como documentação do schema, nunca aplicado pelo Prisma
Migrate).

## Baseline (15/08/2026)

Sem destruir dados, o histórico existente foi marcado como "já aplicado" no
banco local, na ordem cronológica das pastas:

```
0_init
20260613000000_add_seasonal_campaigns
20260613000001_add_product_video_url
20260815000000_add_user_stripe_customer_id
20260815010000_perf_indexes
```

Comando usado para cada uma (idempotente, não executa SQL — só grava a linha
em `_prisma_migrations`):

```bash
yarn prisma migrate resolve --applied <nome_da_migration>
```

Após rodar as cinco, `yarn prisma migrate status` reporta:

```
Database schema is up to date!
```

Sem drift entre o histórico de migrations e o schema real do banco.

## Como aplicar em produção (primeira vez)

Ambientes de produção/staging que também nasceram via `db push` (ou seja,
sem `_prisma_migrations`) precisam do mesmo baseline **antes** do primeiro
`migrate deploy`, na mesma ordem acima:

```bash
yarn prisma migrate resolve --applied 0_init
yarn prisma migrate resolve --applied 20260613000000_add_seasonal_campaigns
yarn prisma migrate resolve --applied 20260613000001_add_product_video_url
yarn prisma migrate resolve --applied 20260815000000_add_user_stripe_customer_id
yarn prisma migrate resolve --applied 20260815010000_perf_indexes
yarn prisma migrate deploy
```

Se o schema real do ambiente já bate com o que essas migrations descrevem
(o que deve ser o caso, já que tudo foi criado via `db push` a partir do
mesmo `schema.prisma`), o `migrate deploy` final não terá nada a aplicar —
ele só passa a registrar o histórico corretamente para futuras migrations.

Ambientes **novos** (banco vazio, nunca tocado por `db push`) não precisam de
baseline: basta rodar `yarn prisma migrate deploy` direto, que aplica as
cinco migrations em sequência.

## Daqui em diante: `migrate deploy`, não `db push`

A partir deste baseline, **todo ambiente com histórico de migrations
(local, staging, produção) deve evoluir via `prisma migrate dev` (para gerar
a migration) + `prisma migrate deploy` (para aplicá-la)**, nunca mais via
`prisma db push`.

### Por quê: o índice `INCLUDE` não é expressável no DSL do Prisma

A migration `20260815010000_perf_indexes` cria:

```sql
CREATE INDEX "orders_status_created_at_idx"
  ON "orders" ("status", "created_at") INCLUDE ("total_amount");
```

O `INCLUDE` (colunas não-chave anexadas ao índice, usadas para permitir
Index Only Scan em `SUM(total_amount)` nos agregados de `GET
/v1/admin/metrics`) **não tem representação no `schema.prisma`** — o
`@@index` do Prisma DSL não suporta cláusula `INCLUDE`. O que existe no
`schema.prisma` é o índice simples `@@index([status, createdAt])`.

Consequência prática: se alguém rodar `prisma db push` a partir de agora, o
Prisma vai comparar o schema DSL com o banco, não achar o `INCLUDE` no DSL, e
**recriar o índice sem `INCLUDE`** — perdendo silenciosamente o Index Only
Scan e voltando a fazer Bitmap Heap Scan com acesso aleatório à heap nos
agregados de receita. Isso não gera nenhum erro, nenhum aviso — só uma
regressão de performance que só apareceria em EXPLAIN ANALYZE ou em latência
de produção sob carga.

`prisma migrate deploy` não tem esse problema: ele só aplica os arquivos
`.sql` em `prisma/migrations/`, que descrevem o `INCLUDE` explicitamente, e
nunca tenta "corrigir" o banco para bater com o DSL.

**Regra prática:** depois de mexer no `schema.prisma`, gerar a migration com
`yarn prisma migrate dev --name <nome>`, revisar o SQL gerado (e adicionar
`INCLUDE`/outras cláusulas que o DSL não expressa, se for o caso) e aplicar
com `yarn prisma migrate deploy` (ou automaticamente pelo `migrate dev` em
dev). Não usar `yarn prisma:push` / `yarn migrate` (que rodam `db push`) em
ambientes que já têm este baseline.
