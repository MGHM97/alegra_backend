---
name: docker-deployment
description: Dockerfile e docker-compose (serviço api) do backend — stages, gotchas de Alpine/musl, volumes
metadata:
  type: project
---

Dockerfile (`/Dockerfile`, criado 15/08/2026) e serviço `api` em
`docker-compose.yml` foram adicionados nesta data — antes disso o projeto não
tinha nenhum artefato de containerização para a API (só Postgres/Redis no
compose).

## Estrutura

Multi-stage: `deps` (instala tudo, inclui devDeps) → `builder` (`prisma
generate` + `tsc -b`) → `runtime` (`node:22-alpine`, só `dist/` +
`node_modules` de produção + Prisma Client gerado copiado do builder,
usuário não-root `node`).

**Por quê:** Node 22 LTS foi escolhido por instrução explícita do usuário,
mesmo com o Node local de dev sendo mais novo (v26 no momento) — não
assumir que a versão de dev é a versão-alvo de produção sem perguntar.

## Gotchas Alpine/musl (não óbvios — já custaram retrabalho em outros projetos)

- **Prisma precisa de `openssl`** instalado via `apk add --no-cache openssl`
  tanto no stage que roda `prisma generate` quanto no `runtime` — os motores
  de query do Prisma linkam contra libssl e falham silenciosamente/com erro
  binário obscuro em Alpine puro sem isso.
- **`bcrypt` (dependência nativa)** precisa de `python3 make g++` para
  compilar via node-gyp quando não há binário pré-compilado pro par
  node/musl exato. No stage `runtime`, isso é instalado como pacote
  `--virtual .build-deps` e removido (`apk del .build-deps`) logo após
  `yarn install --production`, para não inflar a imagem final.
- Builder e runtime usam a MESMA imagem base (`node:22-alpine`) de propósito
  — evita mismatch de engine binário do Prisma Client entre estágios (o
  Prisma gera o binário certo para a lib C do stage onde `generate` rodou;
  se builder/runtime divergissem em libc, o client gerado no builder não
  funcionaria no runtime).
- O `@prisma/client` instalado via `yarn install --production` no runtime é
  só o pacote "vazio" — o client de fato gerado (código + engine binário)
  precisa ser copiado do builder: `node_modules/.prisma` e
  `node_modules/@prisma/client` via `COPY --from=builder`.

## Volumes / rede

- Uploads de produto (`public/uploads/products`, servidos em `/uploads` —
  ver `src/app.ts`) usam um volume nomeado `uploads:/app/public/uploads` no
  serviço `api`, para sobreviver a rebuilds.
- `.env` local (fora de container) aponta `DATABASE_URL`/`REDIS_URL` para
  `localhost` — dentro da rede do compose isso não resolve. O serviço `api`
  sobrescreve essas duas vars via `environment:` no compose (apontando para
  `postgres`/`redis`, os nomes dos serviços), mantendo o resto (JWT, Stripe,
  SMTP) vindo de `env_file: .env`.
- `deploy.replicas` fica comentado no compose com nota explicando que
  escalar horizontalmente exige um proxy/load balancer na frente (não
  incluído aqui de propósito — o frontend traz o seu).

## Validação

`docker compose build api` foi validado localmente (daemon Docker
disponível). Ver [[dependency-bumps]] para o contexto da rodada em que isso
foi criado (bumps de `@fastify/static`/`nodemailer` + paginação +
baseline de migrations, tudo na mesma rodada).
