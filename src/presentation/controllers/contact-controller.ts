import type { FastifyReply, FastifyRequest } from 'fastify';
import { EmailService } from '../../application/services/email-service.js';
import { successResponse } from '../../shared/utils/response.js';
import type { ContactInput } from '../schemas/contact-schemas.js';

const emailService = new EmailService();

export async function contactHandler(
  request: FastifyRequest<{ Body: ContactInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { name, email, subject, message } = request.body;

  await emailService.sendContactForm(name, email, subject, message);

  void reply.status(200).send(
    successResponse({ message: 'Mensagem enviada com sucesso.' }),
  );
}
