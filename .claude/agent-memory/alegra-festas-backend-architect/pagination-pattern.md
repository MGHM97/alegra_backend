---
name: pagination-pattern
description: Padrão validado de paginação por cursor para endpoints não-admin escopados por dono (userId)
metadata:
  type: feedback
---

Padrão confirmado ao adicionar paginação em `GET /v1/orders`
(15/08/2026), replicando o de `listAdminOrdersHandler`
(`admin-order-controller.ts` ~78-102): `take: limit + 1` no repositório,
`cursor: { id }, skip: 1`, `hasMore = rows.length > limit`, `nextCursor =
último id ou null`, resposta via `listResponse(data, nextCursor, hasMore)` —
`data` continua array puro, só ganha `meta: { cursor, hasMore }` ao lado,
mantendo compatibilidade com clientes que só liam `data`.

**Diferença importante ao aplicar isso num recurso do usuário (não-admin):**
o `where: { userId }` sozinho não impede um cursor id de outro usuário —
Prisma localiza a linha do cursor pelo `id`, não filtra pelo resto do
`where`. É necessário um `findFirst({ where: { ...where, id: cursor } })`
explícito confirmando posse ANTES de usar o cursor, devolvendo página vazia
(nunca erro/404 distinguível) se não pertencer — não dar sinal de "cursor
existe mas não é seu" vs "cursor não existe".

**Por quê isso importa:** ficou claro comparando com o padrão admin (que não
precisa dessa checagem, porque lá qualquer order é visível). Reaplicar esse
mesmo padrão sem a checagem de posse num endpoint escopado por usuário seria
uma falha de Zero-Trust — vale conferir em qualquer novo endpoint de listagem
paginada por cursor que seja "meu recurso" (orders, addresses, saved-cards,
etc.) se essa checagem existe.

**Limit:** rejeitar acima do teto com 422 (zod `.max(N)`), não clampar
silenciosamente — cliente que pede 100 e recebe 50 sem erro não sabe que
recebeu menos do que pediu. Ver [[migrations-baseline]] e
[[dependency-bumps]] para o resto da rodada em que isso foi implementado.
