# Memória — alegra-festas-architect (frontend)

- [Yarn Classic, não Berry](tooling_yarn_classic.md) — alegra_frontend usa 1.22.22 real; node:22-alpine já traz pré-instalado, não reinstalar/corepack.
- [Docker/nginx do front](docker_frontend_setup.md) — CSP via envsubst nativo, pegadinha de herança do add_header (testar sempre com curl real, não só nginx -t), topologia do backend (sem serviço `api` no compose ainda).
- [Paginação por cursor](patterns_pagination_orders.md) — ApiListResponseSchema genérico em types/api.ts, padrão useInfiniteQuery com shape achatado, UI é botão "Carregar mais" (não infinite scroll).
