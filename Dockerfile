# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1/3 — deps: instala TODAS as dependências (inclui devDependencies),
# necessárias para compilar TypeScript e gerar o Prisma Client.
# =============================================================================
FROM node:22-alpine AS deps

# python3/make/g++: toolchain nativo exigido pelo bcrypt quando não há
# binário pré-compilado para esta combinação de node/libc (musl).
# openssl: exigido pelos motores de query do Prisma em Alpine (musl).
RUN apk add --no-cache python3 make g++ openssl

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# =============================================================================
# Stage 2/3 — builder: gera o Prisma Client e compila o TypeScript.
# =============================================================================
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json yarn.lock tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

RUN yarn prisma generate
RUN yarn build

# =============================================================================
# Stage 3/3 — runtime: apenas dist/ + node_modules de produção + Prisma
# Client já gerado. Usuário não-root, sem devDependencies, sem código-fonte.
# =============================================================================
FROM node:22-alpine AS runtime

# openssl permanece em runtime: os motores de query do Prisma dependem dele
# em tempo de execução, não só na geração do client.
RUN apk add --no-cache openssl

ENV NODE_ENV=production
WORKDIR /app

COPY package.json yarn.lock ./

# bcrypt precisa do toolchain nativo só durante a instalação; removido logo
# em seguida (--virtual) para manter a imagem final enxuta.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && yarn install --production --frozen-lockfile \
  && apk del .build-deps \
  && yarn cache clean

# Prisma Client gerado no stage builder (código + engine binário para este
# mesmo Alpine/musl) — a instalação de produção acima só traz o pacote
# @prisma/client "vazio"; o client de fato vem daqui.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist

# Uploads de imagem de produto ficam em disco (ver src/app.ts, prefix
# /uploads) — precisa existir e pertencer ao usuário não-root antes do
# volume do compose ser montado por cima.
RUN mkdir -p public/uploads/products \
  && chown -R node:node /app

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3333}/health" || exit 1

CMD ["node", "dist/server.js"]
