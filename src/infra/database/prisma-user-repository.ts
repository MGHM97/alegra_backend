import { prisma } from './prisma-client.js';
import type { UserEntity } from '../../domain/entities/user.js';
import type { CreateUserData, UserRepository } from '../../domain/repositories/user-repository.js';

export class PrismaUserRepository implements UserRepository {
  async findById(id: string): Promise<UserEntity | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    return prisma.user.findUnique({ where: { username } });
  }

  async create(data: CreateUserData): Promise<UserEntity> {
    return prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash: data.passwordHash,
        name: data.name,
        role: data.role ?? 'CUSTOMER',
      },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async updateProfile(userId: string, data: { name?: string; phone?: string }): Promise<UserEntity> {
    return prisma.user.update({
      where: { id: userId },
      data,
    });
  }
}
