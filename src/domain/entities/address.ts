export type AddressType = 'HOME' | 'WORK';

export interface AddressEntity {
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
  addressType: AddressType;
  recipientName: string | null;
  recipientPhone: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
