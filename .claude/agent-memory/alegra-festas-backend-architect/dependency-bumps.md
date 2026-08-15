---
name: dependency-bumps
description: Como investigar e aplicar bumps major com CVE neste projeto — comandos usados, achado sobre @types/nodemailer
metadata:
  type: project
---

## Fluxo usado para @fastify/static ^9→^10 e nodemailer ^8→^9 (15/08/2026)

1. `yarn info <pkg> versions --json` para ver os majors disponíveis.
2. `yarn audit --json` (rodar DEPOIS de já ter a versão nova instalada, ou
   antes para ver o baseline) dá o advisory completo — inclusive a versão
   mínima realmente corrigida, que pode ser mais específica que "o major
   seguinte". Neste caso: `nodemailer` precisava especificamente de
   `>=9.0.1` (GHSA-p6gq-j5cr-w38f, bypass de `disableFileAccess`/
   `disableUrlAccess` via `raw`), não só "qualquer 9.x"; `@fastify/static`
   precisava de `>=10.1.2` (duas CVEs: GHSA-8pvw allowedPath bypass +
   GHSA-83w8 route-guard bypass via `..`/`%2E%2E`), não só "10.0.0". Ler o
   advisory inteiro antes de fixar a versão-alvo — o major sozinho não
   garante que o patch específico está incluso.
3. `yarn add <pkg>@^<major>.<minor>.<patch>` fixando pelo menos o patch
   mínimo corrigido (não confiar em `^<major>` sozinho pegar a versão certa
   por acaso, mesmo que geralmente pegue a mais nova).
4. Ler `node_modules/<pkg>/README.md` (não há CHANGELOG.md empacotado em
   `@fastify/static`) para conferir breaking changes de opções realmente
   usadas no projeto (aqui: `root`, `prefix`, `decorateReply` — nenhuma
   mudou entre v9 e v10).
5. `yarn audit` no final deve dar "0 vulnerabilities found".

## `@types/nodemailer` trava em 8.x mesmo com `nodemailer` em 9.x

`yarn info @types/nodemailer versions` só vai até `8.0.1` — o pacote
DefinitelyTyped não tem (ainda) uma major 9.x, e `nodemailer@9.x` não expõe
tipos próprios (`types`/`typings` vazios no `package.json` publicado). Isso é
esperado, não um erro: manter `@types/nodemailer@^8.0.1` como devDependency
mesmo com `nodemailer@^9`. A API usada no projeto (`createTransport`,
`sendMail({ from, to, subject, html, replyTo })`) é estável o bastante entre
majors para os tipos 8.x continuarem batendo. Revisar se uma major 9.x de
`@types/nodemailer` aparecer no futuro.
