import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserStatus } from '../users/entities/user.entity';
import { RegisterDto, LoginDto, AuthResponseDto } from './dto/auth.dto';
import { JwtPayload } from './strategies/jwt.strategy';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    // Check for existing email
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = this.userRepo.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      passwordHash,
      status: UserStatus.ACTIVE, // In production: PENDING until email is verified
    });

    const saved = await this.userRepo.save(user);
    this.logger.log(`New user registered: ${saved.id}`);

    return this.generateTokenResponse(saved);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });

    // Account lockout check — prevent brute force
    if (user?.isLocked) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil!.getTime() - Date.now()) / 60000,
      );
      throw new UnauthorizedException(
        `Account temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minutes.`,
      );
    }

    // Validate credentials — always run bcrypt even if user not found
    // (prevents user enumeration via timing attack)
    const dummyHash = '$2b$12$dummy.hash.to.prevent.timing.attacks.and.user.enum';
    const passwordValid = await bcrypt.compare(
      dto.password,
      user?.passwordHash || dummyHash,
    );

    if (!user || !passwordValid) {
      if (user) await this.recordFailedAttempt(user);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Clear failed attempts on successful login
    if (user.failedLoginAttempts > 0) {
      await this.userRepo.update(user.id, {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      });
    } else {
      await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Your account has been suspended. Please contact support.');
    }

    this.logger.log(`User logged in: ${user.id}`);
    return this.generateTokenResponse(user);
  }

  async refreshTokens(userId: string, rawRefreshToken: string): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user || !user.refreshTokenHash) {
      throw new ForbiddenException('Access denied — please log in again');
    }

    const tokenMatches = await bcrypt.compare(rawRefreshToken, user.refreshTokenHash);

    if (!tokenMatches) {
      // Refresh token reuse detected — someone is using an old/stolen token.
      // Invalidate ALL sessions as a security measure.
      await this.userRepo.update(userId, { refreshTokenHash: null });
      this.logger.warn(`Refresh token reuse detected for user: ${userId}`);
      throw new ForbiddenException(
        'Security alert: invalid refresh token. All sessions have been invalidated. Please log in again.',
      );
    }

    return this.generateTokenResponse(user);
  }

  async logout(userId: string): Promise<void> {
    await this.userRepo.update(userId, { refreshTokenHash: null });
    this.logger.log(`User logged out: ${userId}`);
  }

  private async generateTokenResponse(user: User): Promise<AuthResponseDto> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      kycTier: user.kycTier,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    ]);

    // Hash and store refresh token
    const refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
    await this.userRepo.update(user.id, { refreshTokenHash });

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        kycTier: user.kycTier,
        status: user.status,
      },
    };
  }

  private async recordFailedAttempt(user: User): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const update: Partial<User> = { failedLoginAttempts: attempts };

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCK_DURATION_MINUTES);
      update.lockedUntil = lockedUntil;
      this.logger.warn(`Account locked after ${attempts} attempts: ${user.id}`);
    }

    await this.userRepo.update(user.id, update);
  }
}