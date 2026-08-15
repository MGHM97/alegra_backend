import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Testes de integração compartilham o mesmo Postgres/Redis. Rodar
    // arquivos em paralelo faz transações Serializable de arquivos
    // diferentes competirem (P2034 intermitente) e o rate limiter de
    // login somar tentativas entre arquivos. A suíte leva ~1,5s — o
    // paralelismo entre arquivos não compra nada aqui.
    fileParallelism: false,
  },
});
