import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaAddressRepository } from '../../infra/database/prisma-address-repository.js';
import type { CreateAddressInput, UpdateAddressInput } from '../schemas/address-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { UnauthorizedError, NotFoundError, ForbiddenError } from '../../domain/errors/app-error.js';

const addressRepository = new PrismaAddressRepository();

function serializeAddress(addr: {
  id: string;
  userId: string;
  label: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  additionalInfo: string | null;
  addressType: string;
  recipientName: string | null;
  recipientPhone: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: addr.id,
    label: addr.label,
    street: addr.street,
    number: addr.number,
    complement: addr.complement,
    neighborhood: addr.neighborhood,
    city: addr.city,
    state: addr.state,
    zipCode: addr.zipCode,
    additionalInfo: addr.additionalInfo,
    addressType: addr.addressType.toLowerCase(),
    recipientName: addr.recipientName,
    recipientPhone: addr.recipientPhone,
    isDefault: addr.isDefault,
  };
}

export async function listAddressesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const addresses = await addressRepository.findByUserId(currentUser.sub);
  void reply.status(200).send(successResponse(addresses.map(serializeAddress)));
}

export async function createAddressHandler(
  request: FastifyRequest<{ Body: CreateAddressInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const address = await addressRepository.create({
    userId: currentUser.sub,
    ...request.body,
  });

  void reply.status(201).send(successResponse(serializeAddress(address)));
}

export async function updateAddressHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateAddressInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const existing = await addressRepository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Address');
  }
  if (existing.userId !== currentUser.sub) {
    throw new ForbiddenError('You can only update your own addresses');
  }

  const updated = await addressRepository.update(request.params.id, request.body);
  void reply.status(200).send(successResponse(serializeAddress(updated)));
}

export async function deleteAddressHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const existing = await addressRepository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Address');
  }
  if (existing.userId !== currentUser.sub) {
    throw new ForbiddenError('You can only delete your own addresses');
  }

  await addressRepository.delete(request.params.id);
  void reply.status(204).send();
}
