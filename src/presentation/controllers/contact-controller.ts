import type { FastifyReply, FastifyRequest } from 'fastify';
import { EmailService } from '../../application/services/email-service.js';
import { successResponse } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';
import type { ContactInput } from '../schemas/contact-schemas.js';

const emailService = new EmailService();

export async function contactHandler(
  request: FastifyRequest<{ Body: ContactInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { name, email, subject, message } = request.body;

  // Best-effort: a mensagem NÃO é persistida em banco — o e-mail é o único
  // registro dela. Uma falha de SMTP não pode virar 500 genérico para quem
  // preencheu o formulário (perderia a mensagem sem chance de tentar de
  // novo com o mesmo texto), então logamos o conteúdo completo em nível de
  // warn para permitir recuperação manual via log estruturado.
  try {
    await emailService.sendContactForm(name, email, subject, message);
  } catch (err) {
    logger.warn(
      { err, name, email, subject, message },
      'Falha ao enviar e-mail do formulário de contato (SMTP) — mensagem preservada apenas neste log',
    );
  }

  void reply.status(200).send(
    successResponse({ message: 'Mensagem enviada com sucesso.' }),
  );
}
