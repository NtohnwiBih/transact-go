import { Body, Controller, Get, Post } from '@nestjs/common';
import { KycService, SubmitKycDto } from './kyc.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('kyc')
export class KycController {
  constructor(private kycService: KycService) {}

  @Post('submit')
  submit(@CurrentUser('id') userId: string, @Body() dto: SubmitKycDto) {
    return this.kycService.submitKyc(userId, dto);
  }

  @Get('submissions')
  getSubmissions(@CurrentUser('id') userId: string) {
    return this.kycService.getUserSubmissions(userId);
  }
}