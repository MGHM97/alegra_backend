export type CardBrand = 'VISA' | 'MASTERCARD' | 'ELO' | 'AMEX' | 'HIPERCARD';
export type CardType = 'CREDIT' | 'DEBIT';

export interface SavedCardEntity {
  id: string;
  userId: string;
  lastFourDigits: string;
  brand: CardBrand;
  holderName: string;
  expiryMonth: number;
  expiryYear: number;
  cardType: CardType;
  cardNumber: string | null;
  holderDocument: string | null;
  issuer: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
