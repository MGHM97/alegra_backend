export interface UserEntity {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  name: string;
  phone: string | null;
  role: 'CUSTOMER' | 'ADMIN';
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeUser {
  id: string;
  email: string;
  username: string;
  name: string;
  phone: string | null;
  role: 'CUSTOMER' | 'ADMIN';
  isActive: boolean;
  createdAt: Date;
}
