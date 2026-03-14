import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaSavedCardRepository } from '../../infra/database/prisma-saved-card-repository.js';
import type { CreateSavedCardInput, UpdateSavedCardInput } from '../schemas/saved-card-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { UnauthorizedError, NotFoundError, ForbiddenError } from '../../domain/errors/app-error.js';

const savedCardRepository = new PrismaSavedCardRepository();

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

export async function createSavedCardHandler(
  request: FastifyRequest<{ Body: CreateSavedCardInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const card = await savedCardRepository.create({
    userId: currentUser.sub,
    ...request.body,
  });

  void reply.status(201).send(successResponse(serializeCard(card)));
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

  await savedCardRepository.delete(request.params.id);
  void reply.status(204).send();
}
