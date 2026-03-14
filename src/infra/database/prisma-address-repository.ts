import { prisma } from './prisma-client.js';
import type { AddressEntity } from '../../domain/entities/address.js';
import type {
  AddressRepository,
  CreateAddressInput,
  UpdateAddressInput,
} from '../../domain/repositories/address-repository.js';

export class PrismaAddressRepository implements AddressRepository {
  async findById(id: string): Promise<AddressEntity | null> {
    return prisma.address.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<AddressEntity[]> {
    return prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(data: CreateAddressInput): Promise<AddressEntity> {
    return prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({
          where: { userId: data.userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          userId: data.userId,
          label: data.label,
          street: data.street,
          number: data.number,
          complement: data.complement ?? null,
          neighborhood: data.neighborhood,
          city: data.city,
          state: data.state,
          zipCode: data.zipCode,
          additionalInfo: data.additionalInfo ?? null,
          addressType: data.addressType ?? 'HOME',
          recipientName: data.recipientName ?? null,
          recipientPhone: data.recipientPhone ?? null,
          isDefault: data.isDefault ?? false,
        },
      });
    });
  }

  async update(id: string, data: UpdateAddressInput): Promise<AddressEntity> {
    const existing = await prisma.address.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Address not found');
    }

    return prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({
          where: { userId: existing.userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id },
        data,
      });
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.address.delete({ where: { id } });
  }
}
