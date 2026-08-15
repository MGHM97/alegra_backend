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
  holderDocument: string | null;
  issuer: string | null;
  isDefault: boolean;
  /** Preenchidos via Stripe SetupIntent (SavedCardService) — null apenas em cartões legados nunca migrados. */
  stripePaymentMethodId: string | null;
  stripeCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
