import {
  IsEmail, IsString, MinLength, MaxLength, Matches, IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({ example: 'Alice' })
  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(50)
  firstName: string;

  @ApiProperty({ example: 'Okafor' })
  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(50)
  lastName: string;

  @ApiProperty({
    example: 'SecurePass1',
    description: 'Min 8 chars — must contain uppercase, lowercase, and a number',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and number',
  })
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({ example: 'SecurePass1' })
  @IsString() @IsNotEmpty()
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token received at login' })
  @IsString() @IsNotEmpty()
  refreshToken: string;
}

class AuthUserDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-...' }) id: string;
  @ApiProperty({ example: 'alice@example.com' }) email: string;
  @ApiProperty({ example: 'Alice' }) firstName: string;
  @ApiProperty({ example: 'Okafor' }) lastName: string;
  @ApiProperty({ example: 1 }) kycTier: number;
  @ApiProperty({ example: 'active' }) status: string;
}

export class AuthResponseDto {
  @ApiProperty({ example: 'eyJhbGci...', description: 'JWT access token (15 min)' })
  accessToken: string;
  @ApiProperty({ example: 'eyJhbGci...', description: 'Refresh token (7 days)' })
  refreshToken: string;
  @ApiProperty({ example: 900 }) expiresIn: number;
  @ApiProperty({ type: AuthUserDto }) user: AuthUserDto;
}