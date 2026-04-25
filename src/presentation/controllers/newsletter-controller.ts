import type { FastifyReply, FastifyRequest } from 'fastify';
import { SubscribeNewsletterUseCase } from '../../application/use-cases/subscribe-newsletter.js';
import { successResponse } from '../../shared/utils/response.js';
import type { SubscribeNewsletterInput } from '../schemas/newsletter-schemas.js';

const subscribeUseCase = new SubscribeNewsletterUseCase();

/**
 * POST /v1/newsletter/subscribe (público)
 *
 * Resposta sempre 200 com payload indicando o estado:
 *   - { subscribed: true }      → novo cadastro
 *   - { reactivated: true }     → estava inativo, foi reativado
 *   - { alreadySubscribed: true } → já estava inscrito (noop)
 *
 * O frontend pode opcionalmente diferenciar a mensagem mostrada, mas
 * todos os três caminhos são "sucessos" para o usuário.
 */
export async function subscribeNewsletterHandler(
  request: FastifyRequest<{ Body: SubscribeNewsletterInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { email } = request.body;
  const result = await subscribeUseCase.execute(email);

  void reply.status(200).send(
    successResponse({
      subscribed: result.status === 'subscribed',
      reactivated: result.status === 'reactivated',
      alreadySubscribed: result.status === 'alreadySubscribed',
      email: result.email,
    }),
  );
}
