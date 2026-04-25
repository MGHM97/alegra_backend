import type { SavedCardEntity, CardBrand, CardType } from '../entities/saved-card.js';

export interface CreateSavedCardInput {
  userId: string;
  lastFourDigits: string;
  brand: CardBrand;
  holderName: string;
  expiryMonth: number;
  expiryYear: number;
  cardType?: CardType;
  holderDocument?: string;
  issuer?: string;
  isDefault?: boolean;
}

export interface UpdateSavedCardInput {
  holderName?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cardType?: CardType;
  isDefault?: boolean;
}

export interface SavedCardRepository {
  findById(id: string): Promise<SavedCardEntity | null>;
  findByUserId(userId: string): Promise<SavedCardEntity[]>;
  create(data: CreateSavedCardInput): Promise<SavedCardEntity>;
  update(id: string, data: UpdateSavedCardInput): Promise<SavedCardEntity>;
  delete(id: string): Promise<void>;
}
