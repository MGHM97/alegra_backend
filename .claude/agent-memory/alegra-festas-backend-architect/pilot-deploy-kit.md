---
name: pilot-deploy-kit
description: Kit de deploy de piloto (Caddy+HTTPS, docker-compose.prod.yml, seed:pilot, TRUST_PROXY_HOPS) criado em 15/08/2026 — layout de arquivos e armadilhas encontradas
metadata:
  type: project
---

Em 15/08/2026 foi montado o kit de deploy do piloto (VPS Ubuntu, Caddy na
frente do nginx, Stripe teste). Decisões/armadilhas que valem a pena
lembrar antes de mexer de novo nessa área:

## Onde os artefatos moram

A pasta pai `Alegra Festas/` (que contém `alegra_backend/`, `alegra_frontend/`
e o `docker-compose.yml` raiz que faz `include:` dos dois) **não é um
repositório git**. Por isso todo artefato de deploy "da raiz" foi
versionado dentro do repo do BACKEND, em `alegra_backend/deploy/`:
`docker-compose.root.yml` (cópia versionada do compose raiz),
`docker-compose.prod.yml` (override com Caddy), `Caddyfile`, `.env.example`
(vars `SITE_DOMAIN`/`API_ORIGIN` da raiz) e `DEPLOY.md`. O passo a passo em
`DEPLOY.md` instrui copiar esses arquivos para a pasta pai no servidor. Se
o compose raiz mudar, editar a cópia em `alegra_backend/deploy/` (fonte da
verdade) e recopiar — não editar a raiz local solta e esquecer de
sincronizar.

## `TRUST_PROXY_HOPS`

`src/infra/config/env.ts` tem `TRUST_PROXY_HOPS` (Zod, default 1),
consumido em `src/app.ts` como `trustProxy: env.TRUST_PROXY_HOPS`. 1 =
topologia padrão (só nginx `web` na frente da API). 2 = Caddy também na
frente (docker-compose.prod.yml já sobrescreve para "2" no serviço `api`).
`tests/auth-hardening.test.ts` depende do default 1 continuar valendo sem
override — não mudar o default sem rodar essa suíte.

## `deploy.resources.limits.memory` não funciona sozinho

Docker Compose (fora do Swarm, sem `--compatibility`) **ignora
silenciosamente** `deploy.resources.limits.memory` num `docker compose up`
normal — só é honrado por `docker stack deploy`. Quem realmente aplica o
cgroup de memória é o atributo legado `mem_limit` no nível do serviço.
`docker-compose.prod.yml` declara os dois por serviço (redundante de
propósito, comentado no topo do arquivo) — se for adicionar limite de
memória a um novo serviço, lembrar de usar `mem_limit`, não só `deploy.*`.

## `nginx.conf` do front — `X-Forwarded-Proto` atrás de Caddy

Antes do Caddy existir, `alegra_frontend/nginx.conf` fazia
`proxy_set_header X-Forwarded-Proto $scheme;` nos blocos `/v1/` e
`/sitemap.xml`. Isso quebra atrás do Caddy: dentro da rede Docker o Caddy
sempre fala com o nginx em HTTP puro, então `$scheme` seria sempre "http"
mesmo com o cliente em https — a API acharia que a conexão não é segura
(cookies `secure` não seriam setados certo). Corrigido com um bloco `map`
no topo do arquivo (fora do `server{}`):
```
map $http_x_forwarded_proto $forwarded_proto {
    default $http_x_forwarded_proto;
    ''      $scheme;
}
```
e os dois `proxy_set_header X-Forwarded-Proto $forwarded_proto;` — repassa
o header do Caddy quando existe, cai em `$scheme` quando o nginx é exposto
direto (sem Caddy, compose sozinho). Validado rodando o entrypoint padrão
da imagem (`docker run --entrypoint /docker-entrypoint.sh ... nginx -t`)
para confirmar que o `envsubst` de `${API_ORIGIN}` não mexe nas variáveis
nginx sem chave (`$scheme`, `$forwarded_proto` etc.) — só substitui
`${VAR}` que batem com env vars reais do container.

## Bug latente encontrado: `VITE_PLAUSIBLE_DOMAIN` nunca chegava no build

`alegra_frontend/.env.compose.example` já documentava `VITE_PLAUSIBLE_DOMAIN`
havia tempo, mas nem o `Dockerfile` (ARG/ENV) nem o `docker-compose.yml`
(build.args) do front passavam essa variável para o build da imagem — só
`VITE_API_BASE_URL`/`VITE_STRIPE_PUBLISHABLE_KEY`/`VITE_WHATSAPP_NUMBER`
estavam wireados. Analytics ficava sempre desligado em qualquer build via
Docker, mesmo com a env var preenchida. Corrigido junto com a adição de
`VITE_SITE_URL` (necessária para o `Sitemap:` correto de `robots.txt` em
produção). Vale conferir esse tipo de gap (env documentada em `.example`
mas não wireada no Dockerfile/compose) da próxima vez que uma `VITE_*`
nova for adicionada.

## `prisma/seed-pilot.ts`

Script separado de `prisma/seed.ts` (que é só para dev/demo e bloqueia
`NODE_ENV=production`). `seed-pilot.ts` roda `yarn seed:pilot`, cria só
admin + 1 cliente de teste com endereço em Manaus, upsert idempotente por
e-mail, só troca senha de conta já existente com
`PILOT_RESET_PASSWORDS=true`. Não importa `env.ts` (que exige
STRIPE_*/SMTP_* completos) de propósito — usa bcrypt direto com rounds=12
fixo, igual ao padrão de `seed.ts`. Excluído do `tsc --noEmit` principal
(mesmo padrão de `seed.ts`, ver `tsconfig.json` `exclude`) mas incluído em
`tsconfig.seed.json` para type-check isolado. Testado manualmente contra o
banco de dev local: cria, idempotência (2ª chamada não mexe em senha),
validação de senha curta falha com exit 1, `PILOT_RESET_PASSWORDS=true`
troca a senha — todos os 4 cenários confirmados antes de fechar a tarefa.
