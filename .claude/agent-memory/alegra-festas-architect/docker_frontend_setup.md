---
name: docker_frontend_setup
description: Dockerfile/nginx.conf de produção do alegra_frontend — decisões de CSP, cache e a pegadinha de herança de add_header
metadata:
  type: project
---

`alegra_frontend/Dockerfile` (multi-stage `node:22-alpine` build →
`nginx:1.27-alpine` runtime), `alegra_frontend/nginx.conf`,
`alegra_frontend/docker-compose.yml` e `.dockerignore` foram criados
nesta rodada. Ver [[tooling_yarn_classic]] para a decisão de não instalar
Yarn extra na imagem builder.

**CSP via envsubst nativo da imagem oficial**: `nginx.conf` é copiado
para `/etc/nginx/templates/default.conf.template`. O entrypoint padrão da
imagem `nginx:1.27-alpine` roda `envsubst` sobre todo `*.template` nesse
diretório antes de iniciar, restrito às variáveis de ambiente
efetivamente definidas no container — por isso só `${API_ORIGIN}` (usado
no `connect-src` da CSP) é substituído; variáveis do próprio Nginx
(`$uri`, `$host`, `$remote_addr`, `$proxy_add_x_forwarded_for`) não são
env vars do SO e permanecem intactas. Não precisa de entrypoint custom.

**Pegadinha de herança do `add_header` (achada e corrigida nesta
rodada)**: se um `location` declara QUALQUER `add_header` próprio, ele
para de herdar TODOS os `add_header` do `server{}` pai — é tudo ou nada
por nível de contexto
(https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header).
Isso mordeu a implementação: `location /assets/` e `location =
/index.html` tinham `add_header Cache-Control ...` próprios, o que
silenciosamente removia CSP/X-Frame-Options/etc. dessas respostas — só
detectado testando com `curl -sD -` de verdade contra o container, não
só `nginx -t` (que não pega isso, é erro semântico não sintático).

Correções aplicadas:
- `location = /index.html`: trocado `add_header Cache-Control "no-cache"`
  por `expires -1;` — produz o mesmo `Cache-Control: no-cache` sem
  declarar `add_header` próprio, então volta a herdar os headers de
  segurança do `server{}` normalmente.
- `location /assets/`: como `immutable`/`public` não têm equivalente via
  `expires`, os 5 `add_header` de segurança foram duplicados
  explicitamente dentro desse location (só opção real além de usar um
  arquivo `include` separado, que teria que também passar por envsubst
  por conter `${API_ORIGIN}`).

**Ao tocar em `nginx.conf` de novo**: sempre validar com
`docker run` + `curl -sD -` contra `/`, uma rota SPA desconhecida e um
asset em `/assets/*` — não confiar só em `nginx -t`.

**Topologia do backend**: `alegra_backend/docker-compose.yml` (na raiz do
repo do backend) hoje só sobe `postgres` e `redis` — a API roda fora do
Docker (`yarn dev`). NÃO existe serviço `api` nem rede `alegra_default`
ainda. O `location /v1/ { proxy_pass http://api:3333; ... }` em
`nginx.conf` e o `depends_on: [api]` em `docker-compose.yml` do front
ficam comentados/documentados até o backend ganhar um serviço `api`
containerizado — não assumir que existem sem checar
`alegra_backend/docker-compose.yml` de novo primeiro.

Origens externas mapeadas para a CSP (recheck se `index.html` ou o
código mudar): `js.stripe.com`/`api.stripe.com` (Stripe Elements),
`fonts.googleapis.com`/`fonts.gstatic.com` (Google Fonts no
`index.html`), `www.youtube.com`/`player.vimeo.com` (iframes de vídeo em
`ProductGallery.tsx`), `viacep.com.br` (fetch de CEP em
`AddressFormModal.tsx`). `img-src` ficou amplo (`'self' data: https:`)
de propósito — thumbnails vêm de picsum/unsplash (produtos-seed) e
uploads do próprio backend, origens variadas demais para listar. `style-src`
precisa de `'unsafe-inline'` — há `style={{}}` inline espalhado pelo
código (11+ arquivos) e o Stripe Elements também injeta estilo inline.
