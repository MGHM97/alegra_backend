import type { FastifyRequest, FastifyReply } from 'fastify';
import type { z } from 'zod';

// Nota: a validação abaixo NÃO faz HTML-encoding do input (ex.: transformar
// "D'Angelo" em "D&#x27;Angelo"). Fazer isso aqui corrompia dados de negócio
// persistidos no banco (nomes, senhas antes do hash, endereços). Escapar
// para exibição em HTML é responsabilidade de quem renderiza HTML (ex.:
// templates de e-mail), não da camada de validação de entrada. Proteção
// contra XSS persistente deve vir de output-encoding no ponto de renderização
// e/ou de Content-Security-Policy (já configurado via fastify-helmet).

export function validateBody<T>(schema: z.ZodType<T>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const parsed = schema.parse(request.body) as T;
    (request.body as T) = parsed;
  };
}

export function validateQuery<T>(schema: z.ZodType<T>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const parsed = schema.parse(request.query) as T;
    (request.query as T) = parsed;
  };
}
