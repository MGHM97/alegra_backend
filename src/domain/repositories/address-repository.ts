import type { AddressEntity, AddressType } from '../entities/address.js';

export interface CreateAddressInput {
  userId: string;
  label: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  additionalInfo?: string;
  addressType?: AddressType;
  recipientName?: string;
  recipientPhone?: string;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  label?: string;
  street?: string;
  number?: string;
  complement?: string | null;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  additionalInfo?: string | null;
  addressType?: AddressType;
  recipientName?: string | null;
  recipientPhone?: string | null;
  isDefault?: boolean;
}

export interface AddressRepository {
  findById(id: string): Promise<AddressEntity | null>;
  findByUserId(userId: string): Promise<AddressEntity[]>;
  create(data: CreateAddressInput): Promise<AddressEntity>;
  update(id: string, data: UpdateAddressInput): Promise<AddressEntity>;
  delete(id: string): Promise<void>;
}
