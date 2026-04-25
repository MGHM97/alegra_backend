import type { UserRepository } from '../../domain/repositories/user-repository.js';
import type { SafeUser } from '../../domain/entities/user.js';
import { ConflictError } from '../../domain/errors/app-error.js';
import { hashPassword } from '../../shared/utils/password.js';
import type { RegisterInput } from '../../presentation/schemas/auth-schemas.js';

export class RegisterUserUseCase {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(input: RegisterInput): Promise<SafeUser> {
    const [existingByEmail, existingByUsername] = await Promise.all([
      this.userRepository.findByEmail(input.email),
      this.userRepository.findByUsername(input.username),
    ]);

    if (existingByEmail) {
      throw new ConflictError('Email already registered');
    }

    if (existingByUsername) {
      throw new ConflictError('Username already taken');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await this.userRepository.create({
      email: input.email,
      username: input.username,
      passwordHash,
      name: input.name,
    });

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }
}
