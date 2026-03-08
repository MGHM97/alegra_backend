import type { UserEntity } from '../entities/user.js';

export interface CreateUserData {
  email: string;
  username: string;
  passwordHash: string;
  name: string;
  role?: 'CUSTOMER' | 'ADMIN';
}

export interface UserRepository {
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  findByUsername(username: string): Promise<UserEntity | null>;
  create(data: CreateUserData): Promise<UserEntity>;
}
