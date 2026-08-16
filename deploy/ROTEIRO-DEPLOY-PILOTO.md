# Roteiro de deploy — piloto Alegra Festas

**Objetivo:** colocar o site no ar com HTTPS, acessível de qualquer navegador/dispositivo, com uma conta admin e uma conta de cliente de teste, banco limpo (sem produtos falsos), Stripe em **modo teste**, e-mails funcionando e backup diário — para as donas testarem tudo.

**Tempo estimado:** 60–90 min na primeira vez, sendo ~20 min de espera (criação do VPS, DNS, build das imagens).

**Como usar este roteiro:** siga os blocos na ordem. Cada bloco termina com **✔ Confirmar** — não avance sem o check bater. Tudo entre `« »` é um valor seu para preencher. Comandos são para copiar e colar.

---

## 0 · Antes de começar — o que ter em mãos

| Item | Onde conseguir | Já tem? |
|---|---|---|
| **VPS Ubuntu 22.04/24.04, ≥ 4 GB RAM** | Recomendado: **Hostinger VPS KVM 2 (São Paulo)** — paga em real, painel pt-BR. Alternativas equivalentes: Vultr / Linode / Lightsail em São Paulo. Ao criar, escolha o template **"Ubuntu 24.04"** puro (não o "Docker" — instalaremos a versão oficial). | ☐ |
| **Domínio** | `alegrafestas.com.br` no registro.br (~R$ 40/ano) — ou, para começar hoje, usar `sslip.io` (grátis, HTTPS real, troca depois sem redeploy). | ☐ |
| **Chaves Stripe de teste** | `pk_test_…` e `sk_test_…` (você já tem). O `whsec_` do webhook será criado no passo 6. | ✔ |
| **SMTP** para e-mails (recuperação de senha, "avalie sua compra") | Opção A: **Brevo** (grátis 300/dia): criar conta → SMTP & API → gerar chave SMTP. Opção B: Gmail `alegrafestascomercial@gmail.com` → Segurança → "Senhas de app" (exige verificação em 2 etapas). | ☐ |
| **Senhas do piloto** | Uma para o **admin** e uma para o **cliente de teste** — ≥ 12 caracteres cada. Anote. | ☐ |
| **Push dos repositórios** | Os dois repos precisam estar no GitHub atualizados: `git -C alegra_backend push origin development` e `git -C alegra_frontend push origin development` (na sua máquina). | ☐ |

> **Nota sobre memória:** os limites do compose de produção somam ~2 GB. Um VPS de exatamente 2 GB funciona apertado; **4 GB é o mínimo confortável**. O KVM 2 da Hostinger tem 8 GB.

---

## 1 · Criar o VPS e apontar o domínio (≈ 10 min)

1. Crie o VPS. Anote o **IP público** (ex.: `187.45.12.34`) e a **senha de root** (ou cadastre sua chave SSH no painel — melhor).
2. **Se tiver domínio:** no painel DNS do registro.br (ou onde o domínio estiver), crie:
   - `A` · nome `@` · valor `«IP do VPS»`
   - `A` · nome `www` · valor `«IP do VPS»`
   
   Propagação leva de 5 min a algumas horas. Teste com `nslookup alegrafestas.com.br` — deve devolver o IP.
3. **Se NÃO tiver domínio:** seu endereço será `alegra.«IP-com-hífens».sslip.io` — ex.: IP `187.45.12.34` → `alegra.187-45-12-34.sslip.io`. Não precisa configurar nada.

**✔ Confirmar:** `ping «SEU_DOMINIO»` responde com o IP do VPS.

---

## 2 · Preparar o servidor (≈ 10 min)

No seu computador, entre no VPS:

```bash
ssh root@«IP do VPS»
```

Cole em bloco (o instalador oficial do Docker é obrigatório — os pacotes do Ubuntu não suportam `include:`/`!override` que o compose usa):

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
docker compose version            # precisa ser >= 2.24
adduser deploy                    # crie uma senha; pode deixar os outros campos em branco
usermod -aG docker deploy
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
su - deploy
```

**✔ Confirmar:** `docker compose version` mostra `v2.24` ou maior, e você está como usuário `deploy` (`whoami`).

---

## 3 · Baixar o projeto (≈ 3 min)

Como `deploy`, na home:

```bash
mkdir -p ~/alegra && cd ~/alegra
git clone -b development https://github.com/MGHM97/alegra_backend.git
git clone -b development https://github.com/MGHM97/alegra_frontend.git

# Artefatos de deploy vivem versionados em alegra_backend/deploy — copie para a raiz:
cp alegra_backend/deploy/docker-compose.root.yml ./docker-compose.yml
cp alegra_backend/deploy/docker-compose.prod.yml ./docker-compose.prod.yml
mkdir -p deploy && cp alegra_backend/deploy/Caddyfile ./deploy/Caddyfile
cp alegra_backend/deploy/.env.example ./.env
cp alegra_backend/.env.production.example alegra_backend/.env
cp alegra_frontend/.env.compose.example alegra_frontend/.env.compose
```

**✔ Confirmar:** `ls ~/alegra` mostra `alegra_backend alegra_frontend deploy docker-compose.yml docker-compose.prod.yml .env`.

---

## 4 · Preencher os três `.env` (≈ 15 min — a parte que exige atenção)

Gere os dois segredos JWT **agora** (dois valores diferentes) e guarde:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

### 4.1 · `~/alegra/.env` (raiz — domínio)

```bash
nano ~/alegra/.env
```
```env
SITE_DOMAIN=«alegrafestas.com.br»           # ou alegra.187-45-12-34.sslip.io
API_ORIGIN=https://«alegrafestas.com.br»
```

### 4.2 · `~/alegra/alegra_backend/.env` (API)

```bash
nano ~/alegra/alegra_backend/.env
```
Preencha/confira estas chaves (as demais podem ficar como estão no exemplo):

```env
NODE_ENV=production
PUBLIC_SITE_URL=https://«SEU_DOMINIO»
CORS_ORIGIN=https://«SEU_DOMINIO»
TRUST_PROXY_HOPS=2                          # Caddy + nginx na frente da API

JWT_SECRET=«primeiro openssl rand»
JWT_REFRESH_SECRET=«segundo openssl rand — DIFERENTE do primeiro»

STRIPE_SECRET_KEY=sk_test_«sua chave de teste»
STRIPE_WEBHOOK_SECRET=whsec_PREENCHER_NO_PASSO_6   # deixe assim por enquanto

SMTP_HOST=«smtp-relay.brevo.com  ou  smtp.gmail.com»
SMTP_PORT=587
SMTP_USER=«login SMTP do Brevo  ou  alegrafestascomercial@gmail.com»
SMTP_PASS=«chave SMTP do Brevo  ou  senha de app do Gmail»
SMTP_FROM="Alegra Festas <alegrafestascomercial@gmail.com>"

PILOT_ADMIN_EMAIL=«e-mail do admin»
PILOT_ADMIN_PASSWORD=«senha ≥ 12 chars»
PILOT_USER_EMAIL=«e-mail do cliente de teste»
PILOT_USER_PASSWORD=«senha ≥ 12 chars»
```

> `DATABASE_URL` e `REDIS_URL` **não precisam mudar**: o compose sobrescreve para a rede interna (`postgres`/`redis`).
> Sem SMTP o site sobe, mas "esqueci minha senha" e o e-mail pós-entrega não chegam (fica só um aviso no log).

### 4.3 · `~/alegra/alegra_frontend/.env.compose` (front — valores entram no build)

```bash
nano ~/alegra/alegra_frontend/.env.compose
```
```env
VITE_API_BASE_URL=/v1
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_«sua chave pública de teste»
VITE_WHATSAPP_NUMBER=5592992767864
VITE_PLAUSIBLE_DOMAIN=                       # vazio = sem analytics por enquanto
VITE_SITE_URL=https://«SEU_DOMINIO»
API_ORIGIN=https://«SEU_DOMINIO»
```

**✔ Confirmar:** `grep -c "PREENCHER\|«" ~/alegra/.env ~/alegra/alegra_backend/.env ~/alegra/alegra_frontend/.env.compose` — só o `STRIPE_WEBHOOK_SECRET` pode estar com placeholder.

---

## 5 · Subir tudo (≈ 10 min de build)

```bash
cd ~/alegra
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Acompanhe o Caddy emitir o certificado (leva ~30 s após o DNS estar certo):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy
# procure por "certificate obtained successfully" — depois Ctrl+C
```

Estado dos serviços:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

O `migrate` roda as migrations e sai (`Exited (0)`) — normal. Os demais ficam `healthy`.

**✔ Confirmar:**
```bash
curl -I https://«SEU_DOMINIO»            # HTTP/2 200, sem erro de certificado
curl https://«SEU_DOMINIO»/health        # {"status":"ok"...} — a API respondendo por trás do nginx
```

Se o certificado falhar: 99% é DNS ainda não propagado ou porta 80 fechada — veja o Troubleshooting.

---

## 6 · Webhook do Stripe (≈ 5 min)

O pagamento aprova no Stripe, mas o pedido só vira "Confirmado" quando o webhook chega.

1. Dashboard do Stripe (**modo teste**) → Developers → Webhooks → **Add endpoint**.
2. URL: `https://«SEU_DOMINIO»/v1/payments/webhook`
3. Eventos (selecione estes 6): `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.
4. Copie o **Signing secret** (`whsec_…`) e coloque em `~/alegra/alegra_backend/.env` → `STRIPE_WEBHOOK_SECRET`.
5. Reinicie só a API:
   ```bash
   cd ~/alegra && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api
   ```
6. (Opcional, mas recomendado) No Dashboard → Settings → Payment methods → ativar **Pix** para testar esse fluxo.

**✔ Confirmar:** no Dashboard, o endpoint aparece **Enabled**; no passo 8 um pagamento de teste deve mudar o pedido para "Confirmado".

---

## 7 · Criar as contas do piloto (≈ 1 min)

```bash
cd ~/alegra
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm migrate yarn seed:pilot
```

Cria **apenas** o admin e o cliente de teste (com um endereço em Manaus para agilizar o checkout). Nenhum produto — as donas cadastram os reais. Rodar de novo não duplica nem troca senha.

**✔ Confirmar:** a saída mostra `admin: criado` e `cliente: criado`.

---

## 8 · Smoke test — o roteiro que as donas vão repetir (≈ 15 min)

Faça você primeiro, num celular **e** num computador:

| # | Ação | Esperado |
|---|---|---|
| 1 | Abrir `https://«SEU_DOMINIO»` | Home com hero, cadeado verde, sem aviso de segurança |
| 2 | Entrar com o **admin** | "Painel Admin" aparece no menu |
| 3 | Admin → Produtos → Novo produto, com **foto** (JPG/PNG até 5 MB) | produto aparece na Home e em /produtos com a foto |
| 4 | Sair · entrar com o **cliente de teste** | Minha conta com o endereço de Manaus já cadastrado |
| 5 | Adicionar o produto ao carrinho → Finalizar → frete "Retirar na loja" → **cartão** `4242 4242 4242 4242`, validade futura, CVC `123` | pedido criado; em ~5 s "Meus pedidos" mostra **Confirmado** (webhook OK) |
| 6 | Se Pix ativado: repetir com Pix | QR code aparece; no Dashboard do Stripe (teste) marque como pago → pedido Confirmado |
| 7 | Admin → Pedidos → mudar status → Enviado (com código de rastreio) | cliente vê o stepper avançar |
| 8 | "Esqueci minha senha" com o e-mail do cliente | e-mail chega (SMTP OK) |
| 9 | Minha conta → Formas de pagamento → Adicionar cartão `4242…` | cartão salvo com bandeira Visa; próxima compra pode usar "cartão salvo" |
| 10 | Rolar o site no celular: header, filtros, lightbox do produto, carrinho, checkout | nada cortado, botões alcançáveis |

**✔ Confirmar:** os 10 passaram. Se o item 5 ficar em "Pendente", é webhook (passo 6); se o 8 não chegar, é SMTP (4.2).

---

## 9 · Entregar para as donas

Envie para elas:

- **Endereço:** `https://«SEU_DOMINIO»`
- **Admin:** «e-mail» / «senha» — para cadastrar produtos, ver pedidos, cupons, estoque
- **Cliente de teste:** «e-mail» / «senha» — para comprar como uma cliente
- **Cartão de teste:** `4242 4242 4242 4242`, qualquer validade futura, qualquer CVC (não cobra nada)
- **Cartão recusado (para testar erro):** `4000 0000 0000 0002`
- Peça que anotem: o que estranharam, o que não acharam, em qual celular/navegador.

---

## 10 · Operação do dia a dia

Sempre em `cd ~/alegra` e com o prefixo `docker compose -f docker-compose.yml -f docker-compose.prod.yml` (dica: `alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml'`).

| Preciso… | Comando |
|---|---|
| Ver se está tudo de pé | `dc ps` |
| Logs da API / do Caddy | `dc logs -f api` · `dc logs -f caddy` |
| **Atualizar o site** após novos commits | `git -C alegra_backend pull && git -C alegra_frontend pull && dc up -d --build` (migrations rodam sozinhas) |
| Reiniciar um serviço | `dc restart api` |
| Trocar um `.env` | editar → `dc up -d api` (ou `dc up -d --build web` se for do front) |
| Ver backups (diários, 7 dias) | `dc exec backup ls -la /backups` |
| Restaurar um backup | `dc exec -T postgres pg_restore -U alegra -d alegra_festas --clean --if-exists < backup.dump` (detalhes no `deploy/DEPLOY.md`) |
| Espaço em disco | `df -h` e `docker system df` (limpar imagens antigas: `docker image prune -f`) |

---

## Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Caddy não emite certificado / navegador reclama | DNS não propagou, ou porta 80 fechada | `nslookup «DOMINIO»` deve dar o IP; `ufw status` deve mostrar 80 e 443; `dc logs caddy` |
| Site abre, mas login/produtos dão erro 502 | API não subiu | `dc logs api` — quase sempre `.env` do back com valor errado (a API **aborta o boot** em produção se `CORS_ORIGIN`/`PUBLIC_SITE_URL` tiverem `localhost`/`http://`, ou se os JWT forem iguais/placeholder) |
| Pedido fica "Pendente" após pagar | webhook não chega | passo 6: URL, os 6 eventos, `whsec_` certo, `dc up -d api` depois de editar |
| "Muitas tentativas" ao logar | rate limit por IP (várias pessoas na mesma rede errando senha) | espera 15 min, ou `dc exec redis redis-cli --scan --pattern 'ratelimit:*' \| xargs -r dc exec -T redis redis-cli DEL` |
| Upload de imagem falha | arquivo > 5 MB ou não é imagem real | reduzir; formatos aceitos JPG/PNG/WebP |
| Site lento no primeiro acesso após reinício | cache frio | normal; some após a primeira navegação |
| Trocar de `sslip.io` para domínio real | — | ajustar `SITE_DOMAIN`/`API_ORIGIN` no `.env` raiz, `PUBLIC_SITE_URL`/`CORS_ORIGIN` no back, `VITE_SITE_URL`/`API_ORIGIN` no front → `dc up -d --build` |

---

## Depois do piloto (não agora)

- Stripe em modo **live** (`sk_live_`/`pk_live_`), webhook live, ativar Pix live.
- Fotos reais de produto em fundo branco (é o que mais muda a percepção do site).
- Preencher a **razão social** em `alegra_frontend/src/config/store.ts`.
- Cotação real de frete (Correios/Melhor Envio), NF-e, uploads em S3/R2, Sentry.
- Domínio definitivo se começou com `sslip.io`.
