---
name: patterns_pagination_orders
description: Padrão de paginação por cursor no alegra_frontend (ApiListResponseSchema genérico + useInfiniteQuery) e onde já é usado
metadata:
  type: project
---

`src/types/api.ts` já tem um `ApiListResponseSchema<T>` genérico
(`{ status: 'success', data: T[], meta: { cursor: string | null, hasMore:
boolean } }`) e o tipo companheiro `ApiListResponse<T>` — é a fonte única
para qualquer endpoint paginado por cursor. Antes de criar um schema de
lista paginada novo, checar se dá para reusar este (ver
`admin-reviews.service.ts` e `admin-coupons.service.ts` para exemplos de
uso; `admin-orders.service.ts`/`admin-order.ts` tem uma cópia duplicada
manual — `AdminOrderListResponseSchema` — que poderia ter reusado o
genérico mas não reusa; não vale a pena migrar sem pedido explícito).

Hook: o padrão estabelecido para uma lista paginada é `useInfiniteQuery`
com `initialPageParam: undefined as string | undefined` e
`getNextPageParam: (last) => last.meta.hasMore ? (last.meta.cursor ??
undefined) : undefined`. Ver `useInfiniteProducts` em
`src/hooks/useProducts.ts` (primeiro a implementar isso) e `useOrders` em
`src/hooks/useOrders.ts` (migrado nesta rodada de `useQuery<Order[]>`
simples para infinito). Ambos os hooks expõem um shape achatado
(`orders`/`products` já como array flat de todas as páginas via
`useMemo`) em vez do `data.pages` cru do TanStack Query — os componentes
consumidores não devem saber de paginação por página.

UI: o padrão do projeto é botão "Carregar mais X" no fim da lista (NÃO
`IntersectionObserver`/infinite scroll) — ver `ProductsPage.tsx` (padrão
original) e `OrdersPage.tsx` (replicado). SCSS: classe `&__loadMore` com
`display: flex; justify-content: center; margin-top: $spacing-8;`.

Quando um consumidor precisa de uma lista pequena e fixa sem "carregar
mais" (ex.: card "últimos pedidos" no `DashboardPage.tsx`), o hook aceita
um `limit` que é extraído do objeto de filtros antes de virar a
`queryKey`/query params — o consumidor simplesmente não renderiza o botão
mesmo que `hasNextPage` seja `true`.
