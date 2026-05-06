import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Version,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, AuthResponseDto } from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * POST /api/v1/auth/register
   * Create a new account. No auth required.
   */
  @Public()
  @Post('register')
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 registrations per minute per IP
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  /**
   * POST /api/v1/auth/login
   * Exchange email/password for access + refresh tokens.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 login attempts per minute
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  /**
   * POST /api/v1/auth/refresh
   * Exchange a valid refresh token for new access + refresh tokens.
   * The old refresh token is invalidated (rotation).
   *
   * Send the refresh token as: Authorization: Bearer <refreshToken>
   */
  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@CurrentUser() user: any): Promise<AuthResponseDto> {
    return this.authService.refreshTokens(user.sub, user.refreshToken);
  }

  /**
   * POST /api/v1/auth/logout
   * Invalidates the current refresh token.
   * Client must discard both tokens.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser('id') userId: string): Promise<void> {
    return this.authService.logout(userId);
  }
}