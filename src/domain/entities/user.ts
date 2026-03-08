export interface UserEntity {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  name: string;
  role: 'CUSTOMER' | 'ADMIN';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeUser {
  id: string;
  email: string;
  username: string;
  name: string;
  role: 'CUSTOMER' | 'ADMIN';
  isActive: boolean;
  createdAt: Date;
}
