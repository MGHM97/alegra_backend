import { prisma } from './prisma-client.js';
import type { SavedCardEntity } from '../../domain/entities/saved-card.js';
import type {
  SavedCardRepository,
  CreateSavedCardInput,
  UpdateSavedCardInput,
} from '../../domain/repositories/saved-card-repository.js';

export class PrismaSavedCardRepository implements SavedCardRepository {
  async findById(id: string): Promise<SavedCardEntity | null> {
    const card = await prisma.savedCard.findUnique({ where: { id } });
    return card as SavedCardEntity | null;
  }

  async findByUserId(userId: string): Promise<SavedCardEntity[]> {
    const cards = await prisma.savedCard.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return cards as SavedCardEntity[];
  }

  async create(data: CreateSavedCardInput): Promise<SavedCardEntity> {
    const card = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.savedCard.updateMany({
          where: { userId: data.userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.savedCard.create({
        data: {
          userId: data.userId,
          lastFourDigits: data.lastFourDigits,
          brand: data.brand,
          holderName: data.holderName,
          expiryMonth: data.expiryMonth,
          expiryYear: data.expiryYear,
          cardType: data.cardType ?? 'CREDIT',
          holderDocument: data.holderDocument ?? null,
          issuer: data.issuer ?? null,
          isDefault: data.isDefault ?? false,
        },
      });
    });
    return card as SavedCardEntity;
  }

  async update(id: string, data: UpdateSavedCardInput): Promise<SavedCardEntity> {
    const existing = await prisma.savedCard.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Saved card not found');
    }

    const card = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.savedCard.updateMany({
          where: { userId: existing.userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      return tx.savedCard.update({
        where: { id },
        data,
      });
    });
    return card as SavedCardEntity;
  }

  async delete(id: string): Promise<void> {
    await prisma.savedCard.delete({ where: { id } });
  }
}
