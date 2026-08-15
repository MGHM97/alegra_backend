import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { PrismaSavedCardRepository } from '../../infra/database/prisma-saved-card-repository.js';
import { prisma } from '../../infra/database/prisma-client.js';
import { SavedCardService } from '../../application/services/saved-card-service.js';
import type { CreateSavedCardInput, UpdateSavedCardInput } from '../schemas/saved-card-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { UnauthorizedError, NotFoundError, ForbiddenError } from '../../domain/errors/app-error.js';

const savedCardRepository = new PrismaSavedCardRepository();
const savedCardService = new SavedCardService();

function serializeCard(card: {
  id: string;
  userId: string;
  lastFourDigits: string;
  brand: string;
  holderName: string;
  expiryMonth: number;
  expiryYear: number;
  cardType: string;
  holderDocument: string | null;
  issuer: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: card.id,
    lastFourDigits: card.lastFourDigits,
    brand: card.brand.toLowerCase(),
    holderName: card.holderName,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    cardType: card.cardType.toLowerCase(),
    holderDocument: card.holderDocument,
    issuer: card.issuer,
    isDefault: card.isDefault,
  };
}

/** Carrega o usuário autenticado com os campos usados para o customer da Stripe. */
async function loadCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  });
  if (!user) {
    throw new NotFoundError('Usuário');
  }
  return user;
}

export async function listSavedCardsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const cards = await savedCardRepository.findByUserId(currentUser.sub);
  void reply.status(200).send(successResponse(cards.map(serializeCard)));
}

/**
 * POST /v1/cards/setup-intent — inicia a tokenização de um novo cartão.
 * Cria (ou reaproveita) o Customer da Stripe do usuário e devolve o
 * clientSecret de um SetupIntent, que o frontend usa com Stripe.js/Elements
 * para coletar os dados do cartão SEM que eles passem pelo nosso backend.
 */
export async function createSetupIntentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const user = await loadCurrentUser(currentUser.sub);
  const customerId = await savedCardService.getOrCreateCustomer(user);
  const setupIntent = await savedCardService.createSetupIntent(customerId, user.id);

  if (!setupIntent.client_secret) {
    throw new Error('Stripe não retornou client_secret para o SetupIntent.');
  }

  void reply.status(200).send(successResponse({ clientSecret: setupIntent.client_secret }));
}

export async function createSavedCardHandler(
  request: FastifyRequest<{ Body: CreateSavedCardInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const user = await loadCurrentUser(currentUser.sub);
  const customerId = await savedCardService.getOrCreateCustomer(user);

  const paymentMethod = await savedCardService.resolvePaymentMethod(
    request.body.paymentMethodId,
    customerId,
  );
  const cardDetails = savedCardService.extractCardDetails(paymentMethod);

  // Idempotência: o mesmo payment_method já foi salvo por este usuário
  // (ex.: retry de rede no front). Devolvemos o registro existente em vez
  // de duplicar.
  const existing = await savedCardRepository.findByUserIdAndStripePaymentMethodId(
    user.id,
    cardDetails.stripePaymentMethodId,
  );
  if (existing) {
    void reply.status(200).send(successResponse(serializeCard(existing)));
    return;
  }

  try {
    const card = await savedCardRepository.create({
      userId: user.id,
      stripePaymentMethodId: cardDetails.stripePaymentMethodId,
      stripeCustomerId: customerId,
      lastFourDigits: cardDetails.lastFourDigits,
      brand: cardDetails.brand,
      holderName: request.body.holderName,
      expiryMonth: cardDetails.expiryMonth,
      expiryYear: cardDetails.expiryYear,
      cardType: request.body.cardType,
      holderDocument: request.body.holderDocument,
      issuer: cardDetails.issuer,
      isDefault: request.body.isDefault,
    });
    void reply.status(201).send(successResponse(serializeCard(card)));
  } catch (err) {
    // Corrida: duas requisições concorrentes para o mesmo payment_method
    // podem passar ambas pelo check de idempotência acima antes de uma
    // delas gravar. A constraint única (userId, stripePaymentMethodId)
    // rejeita a segunda com P2002 — buscamos o registro que "ganhou" a
    // corrida e devolvemos como se fosse idempotente, em vez de propagar 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await savedCardRepository.findByUserIdAndStripePaymentMethodId(
        user.id,
        cardDetails.stripePaymentMethodId,
      );
      if (raced) {
        void reply.status(200).send(successResponse(serializeCard(raced)));
        return;
      }
    }
    throw err;
  }
}

export async function updateSavedCardHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateSavedCardInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const existing = await savedCardRepository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Saved card');
  }
  if (existing.userId !== currentUser.sub) {
    throw new ForbiddenError('You can only update your own cards');
  }

  const updated = await savedCardRepository.update(request.params.id, request.body);
  void reply.status(200).send(successResponse(serializeCard(updated)));
}

export async function deleteSavedCardHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const existing = await savedCardRepository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Saved card');
  }
  if (existing.userId !== currentUser.sub) {
    throw new ForbiddenError('You can only delete your own cards');
  }

  if (existing.stripePaymentMethodId) {
    await savedCardService.detachPaymentMethod(existing.stripePaymentMethodId);
  }

  await savedCardRepository.delete(request.params.id);
  void reply.status(204).send();
}
