# Deploy do Piloto — Alegra Festas

Guia passo a passo para colocar o piloto no ar numa VPS Ubuntu 22.04/24.04
(2–8GB), com HTTPS automático via Caddy, Stripe em modo teste e poucos
usuários. Copiável linha a linha.

Arquitetura:

```
Internet ──443/80──▶ Caddy (TLS automático) ──80──▶ nginx `web` ──/v1/──▶ api (Fastify)
                                                                             ├──▶ postgres
                                                                             └──▶ redis
```

Só o Caddy expõe porta no host. `web`, `api`, `postgres`, `redis` só
existem na rede interna do Docker.

---

## 0. O que ter em mãos antes de começar

- Acesso SSH a uma VPS Ubuntu 22.04 ou 24.04 (2GB mínimo — ver aviso de
  memória no passo 4; 4GB é o recomendado para folga real).
- Um domínio com registro A (e AAAA, se o VPS tiver IPv6) apontando para o
  IP do VPS — **ou**, sem domínio próprio, um host `sslip.io`
  (`algumacoisa.SEU-IP-COM-HIFENS.sslip.io`, ex.: IP `203.0.113.10` vira
  `alegra.203-0-113-10.sslip.io`). Funciona igual a um domínio real para
  fins de certificado TLS — nenhuma configuração de DNS extra é necessária.
- Chaves de teste do Stripe (`sk_test_...` e a publicável `pk_test_...`),
  criadas no [Dashboard do Stripe](https://dashboard.stripe.com/test/apikeys)
  em modo TESTE.
- Credenciais de SMTP: Brevo (SMTP key, plano grátis cobre o volume de um
  piloto) ou Gmail com senha de app (exige 2FA ativado na conta Google).
- As portas 22 (SSH), 80 e 443 abertas no firewall/security group do
  provedor da VPS (além do `ufw` interno configurado no passo 1).

---

## 1. Preparar o servidor

```bash
ssh root@SEU_IP

apt update && apt upgrade -y

# Docker Engine + Compose plugin via o repositório OFICIAL do Docker — NÃO
# use os pacotes `docker.io`/`docker-compose-v2` do repositório padrão do
# Ubuntu: em algumas versões do Ubuntu eles ficam desatualizados demais e
# não suportam `include:`/a tag de merge `!override` usadas nos compose
# deste projeto (precisa de Docker Compose >= 2.24). O script abaixo é o
# instalador oficial da Docker Inc., idempotente:
curl -fsSL https://get.docker.com | sh

# Confirma a versão do Compose (precisa ser >= 2.24):
docker compose version

# Usuário não-root para operar o dia a dia (evita rodar tudo como root):
adduser deploy
usermod -aG docker deploy

# Firewall: só SSH, HTTP (redirect + ACME challenge) e HTTPS.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
# Swap de 2GB (colchão de memória para builds/picos numa VPS de 2GB):
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# A partir daqui, troque para o usuário deploy:
su - deploy
```

---

## 2. Clonar os repositórios e organizar a pasta de deploy

```bash
mkdir -p ~/alegra && cd ~/alegra

git clone <URL_DO_REPO_BACKEND> alegra_backend
git clone <URL_DO_REPO_FRONTEND> alegra_frontend

# Os artefatos de deploy (compose raiz, override de produção, Caddyfile,
# .env de exemplo) vivem VERSIONADOS dentro do repo do backend, em
# alegra_backend/deploy/ — copie-os para a raiz `~/alegra/` (mesmo nível
# dos dois repos), que é de onde os comandos `docker compose` abaixo rodam:
cp alegra_backend/deploy/docker-compose.root.yml docker-compose.yml
cp alegra_backend/deploy/docker-compose.prod.yml docker-compose.prod.yml
mkdir -p deploy
cp alegra_backend/deploy/Caddyfile deploy/Caddyfile

# Layout final esperado:
#   ~/alegra/
#   ├── alegra_backend/       (repo)
#   ├── alegra_frontend/      (repo)
#   ├── docker-compose.yml    (copiado de alegra_backend/deploy/docker-compose.root.yml)
#   ├── docker-compose.prod.yml
#   ├── deploy/Caddyfile
#   └── .env                  (próximo passo)
```

Ao atualizar depois (`git pull`), reveja se `docker-compose.root.yml`,
`docker-compose.prod.yml` ou `Caddyfile` mudaram no repo do backend e
recopie — eles não são symlinks, é cópia mesmo.

---

## 3. Configurar os três `.env`

São **três arquivos `.env` distintos**, um por camada — não confunda um
com o outro:

```bash
# 3.1 — .env do backend (segredos de API, DB, JWT, Stripe, SMTP, PILOT_*)
cp alegra_backend/.env.production.example alegra_backend/.env
nano alegra_backend/.env
#   - JWT_SECRET / JWT_REFRESH_SECRET: gere com `openssl rand -base64 48`
#     (rode duas vezes, um valor para cada — DIFERENTES entre si)
#   - CORS_ORIGIN / PUBLIC_SITE_URL: https://SEU_DOMINIO (troque SITE_DOMAIN)
#   - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET: sk_test_.../whsec_...
#     (o whsec_ só existe depois de criar o endpoint no Stripe — passo 3.2)
#   - SMTP_*: credenciais reais (Brevo ou Gmail com senha de app)
#   - PILOT_ADMIN_EMAIL / PILOT_ADMIN_PASSWORD (min. 12 caracteres)
#   - PILOT_USER_EMAIL / PILOT_USER_PASSWORD (min. 12 caracteres)

# 3.2 — Webhook do Stripe (produção/piloto)
#   No Dashboard do Stripe (modo TESTE) > Developers > Webhooks > Add endpoint:
#     URL:     https://SEU_DOMINIO/v1/payments/webhook
#     Eventos: payment_intent.succeeded, payment_intent.payment_failed,
#              payment_intent.canceled, charge.refunded,
#              charge.dispute.created, charge.dispute.closed
#   Copie o "Signing secret" (whsec_...) gerado e cole em
#   STRIPE_WEBHOOK_SECRET no alegra_backend/.env acima.

# 3.3 — .env.compose do frontend (build args da imagem Vite/Nginx)
cp alegra_frontend/.env.compose.example alegra_frontend/.env.compose
nano alegra_frontend/.env.compose
#   - VITE_STRIPE_PUBLISHABLE_KEY: pk_test_...
#   - VITE_SITE_URL / API_ORIGIN: https://SEU_DOMINIO (mesmo domínio de cima)

# 3.4 — .env da RAIZ (Caddy: domínio + same-origin do nginx)
cp alegra_backend/deploy/.env.example .env
nano .env
#   - SITE_DOMAIN: SEU_DOMINIO (ou o host sslip.io)
#   - API_ORIGIN:  https://SEU_DOMINIO (mesmo valor de novo)
```

As 3 variáveis de domínio (`CORS_ORIGIN`/`PUBLIC_SITE_URL` do backend,
`VITE_SITE_URL`/`API_ORIGIN` do front, `SITE_DOMAIN`/`API_ORIGIN` da raiz)
**precisam apontar para o mesmo domínio** — divergência entre elas quebra
CSP, cookies `secure` ou o certificado TLS.

---

## 4. Subir os containers

```bash
cd ~/alegra
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Isso builda as imagens de `api` e `web`, sobe `postgres`/`redis`, roda o
serviço `migrate` (`prisma migrate deploy` — aplica o schema no banco vazio)
e só então sobe `api`, `web` e `caddy`. Acompanhe:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy
# espere uma linha "certificate obtained successfully" (ou similar) do Caddy
```

> **Memória:** os limites do override somam 1280M (api 384M + postgres 512M +
> redis 128M + web 128M + caddy 128M) — calibrado para VPS de **2GB** (ex.
> Lightsail US$12) com ~700M de folga. Com 4GB+ pode dobrar postgres/api.
> Crie 2GB de swap no host (passo 1) como colchão para picos de build.

---

## 5. Popular as contas do piloto

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm migrate yarn seed:pilot
```

Cria só duas contas (lê `PILOT_ADMIN_EMAIL`/`PILOT_ADMIN_PASSWORD` e
`PILOT_USER_EMAIL`/`PILOT_USER_PASSWORD` do `alegra_backend/.env`): o admin
e um cliente de teste com 1 endereço em Manaus (Rua 26 de Agosto, 601,
Cidade Nova, 69095-187) já cadastrado, para agilizar o teste de checkout
com frete local. Nenhum produto, pedido ou review é criado — cadastre os
produtos reais pelo painel admin no passo seguinte.

Rodar de novo é seguro (idempotente) e NÃO troca as senhas, a menos que
`PILOT_RESET_PASSWORDS=true` esteja no `.env` do backend.

---

## 6. Checklist de smoke test

```bash
curl -I https://SEU_DOMINIO           # 200 (ou 30x), certificado válido
curl https://SEU_DOMINIO/health       # via nginx -> api: {"status":"ok"} (nginx faz proxy de /health)
```

Pelo navegador:

1. `https://SEU_DOMINIO/login` — entre com `PILOT_ADMIN_EMAIL`/`PILOT_ADMIN_PASSWORD`.
2. `https://SEU_DOMINIO/admin/produtos` — cadastre 1 produto real, com pelo
   menos 1 imagem (confirma que o volume `uploads` e o upload multipart
   estão funcionando).
3. Faça logout, cadastre-se (ou entre com `PILOT_USER_EMAIL`/`PILOT_USER_PASSWORD`
   — já tem endereço em Manaus pronto) e compre o produto cadastrado com o
   cartão de teste `4242 4242 4242 4242`, validade futura qualquer,
   CVV qualquer.
4. Volte ao admin (`/admin/pedidos`) e confirme que o pedido aparece como
   **CONFIRMED** — isso só acontece se o webhook do Stripe (passo 3.2)
   chegou e foi validado com sucesso.
5. Se for testar PIX: confirme que o método aparece no checkout e que o
   QR Code é gerado (Stripe modo teste simula a confirmação).
6. Teste "esqueci minha senha" e o formulário de contato — ambos dependem
   do SMTP configurado no passo 3.1; se o e-mail não chegar, veja
   Troubleshooting.

---

## 7. Operação do dia a dia

**Logs:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy
```

**Atualizar (deploy de uma nova versão):**

```bash
cd ~/alegra/alegra_backend && git pull && cd ..
cd ~/alegra/alegra_frontend && git pull && cd ..
# Se docker-compose.root.yml / docker-compose.prod.yml / Caddyfile mudaram
# no repo do backend, recopie (ver passo 2).
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

O serviço `migrate` roda automaticamente antes do `api` subir a cada `up`
— novas migrations são aplicadas sem passo manual extra.

**Backup / restore:** o serviço `backup` já faz `pg_dump` diário (retenção
de 7 dias) para o volume `pgbackups`, automaticamente — nenhuma ação
necessária no dia a dia. Para restaurar, ver o comentário completo em
`alegra_backend/docker-compose.yml` (serviço `backup`), resumindo:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml cp \
  backup:/backups/alegra_YYYYMMDD_HHMM.dump ./
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U alegra -d alegra_festas --clean --if-exists \
  < alegra_YYYYMMDD_HHMM.dump
```

**Rotação de segredos:** gere um novo valor (`openssl rand -base64 48` para
JWT, nova SMTP key/senha de app, etc.), atualize `alegra_backend/.env` e
suba de novo (`up -d`, sem `--build` se só o `.env` mudou). Trocar
`JWT_SECRET`/`JWT_REFRESH_SECRET` invalida todas as sessões ativas (todo
mundo precisa logar de novo) — é o comportamento esperado.

---

## 8. Troubleshooting

**Certificado TLS não sai / Caddy fica tentando:**
- Porta 80 precisa estar acessível pela internet (ACME HTTP-01) — confira
  `ufw status` no VPS E o firewall/security group do provedor da nuvem.
- DNS: `dig +short SEU_DOMINIO` deve retornar o IP do VPS. Propagação de
  DNS pode levar minutos a horas depois de criar o registro A.
- Logs: `docker compose ... logs caddy` — mensagens de erro do ACME
  costumam ser explícitas (`dns problem`, `connection refused`, `too many
  requests` se você bateu o rate limit do Let's Encrypt testando demais —
  nesse caso, espere ou use o ambiente de staging da Let's Encrypt
  temporariamente).

**502 Bad Gateway (Caddy ou nginx):**
- `api` ainda subindo ou falhou o healthcheck: `docker compose ... ps` —
  veja se `api` está `healthy`. Se não, `docker compose ... logs api`
  costuma apontar env var faltando/inválida (o boot do Fastify ABORTA com
  mensagem clara se `NODE_ENV=production` e algo estiver mal configurado —
  ver `assertProductionSafety` em `alegra_backend/src/infra/config/env.ts`).
- `migrate` falhou e não completou: `api` não sobe (`depends_on:
  service_completed_successfully`). Veja `docker compose ... logs migrate`.

**Cookies de login não "pegam" / usuário desloga sozinho:**
- O refresh token só sai como `secure` (exigido por HTTPS) quando a API
  enxerga a requisição como `https`. Isso depende de duas coisas em
  cadeia: (1) `TRUST_PROXY_HOPS=2` no `api` (o override de produção já
  define isso) e (2) o nginx do `web` repassando o `X-Forwarded-Proto` que
  o Caddy manda, em vez de usar o próprio `$scheme` (que dentro da rede
  Docker seria sempre `http`) — confira em `alegra_frontend/nginx.conf`
  que os dois `proxy_set_header X-Forwarded-Proto` usam `$forwarded_proto`
  (não `$scheme`); se o front foi clonado antes dessa correção, `git pull`
  nele e rebuilde (`up -d --build`).

**Upload de imagem de produto falha ou some depois de um redeploy:**
- Confirme que o volume nomeado `uploads` existe e não foi removido
  (`docker volume ls | grep uploads`) — `docker compose down -v` REMOVE
  volumes, nunca use `-v` em produção sem saber exatamente o que está
  fazendo.

**E-mail (recuperação de senha / contato) não chega:**
- Desde este kit de piloto, falha de SMTP é *best-effort*: a request
  continua respondendo 200 mesmo se o e-mail não sair (ver
  `password-reset-controller.ts`/`contact-controller.ts`) — para
  diagnosticar, olhe os logs (`docker compose ... logs api | grep -i
  smtp`, mensagem `logger.warn` com o erro real do Nodemailer). Causas
  comuns: senha de app do Gmail expirada/revogada, `SMTP_PORT`/`secure`
  incompatível (587 = STARTTLS, `secure:false`; 465 = TLS direto,
  `secure:true` — o código já decide isso automaticamente por
  `SMTP_PORT === 465`), ou IP do VPS bloqueado pelo provedor de e-mail
  (comum com Gmail; Brevo costuma ser mais tolerante para VPS).

**`TRUST_PROXY_HOPS` errado (sintoma: rate limiting/IP nos logs bate
sempre no mesmo valor, ou parece fácil de burlar):**
- 1 = só o nginx do compose na frente da API (sem Caddy — compose sozinho,
  smoke test local).
- 2 = Caddy + nginx (topologia deste guia, docker-compose.prod.yml).
- Subestimar: rate limiting vê o IP do Caddy/nginx para todo mundo (todo
  cliente compartilha o mesmo "IP"). Superestimar: o cliente pode forjar
  `X-Forwarded-For` e burlar o rate limiting. Sempre iguale ao número real
  de proxies reversos na frente da API.
