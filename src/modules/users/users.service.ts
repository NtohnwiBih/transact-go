import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async updateRefreshToken(userId: string, hash: string | null): Promise<void> {
    await this.userRepo.update(userId, { refreshTokenHash: hash });
  }

  async getProfile(userId: string): Promise<Omit<User, 'passwordHash' | 'refreshTokenHash'>> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, refreshTokenHash, ...profile } = user;
    return {
        ...user,
        fullName: `${user.firstName} ${user.lastName}`,
        isLocked: !!user.lockedUntil && user.lockedUntil > new Date(),
    };
  }
  
}