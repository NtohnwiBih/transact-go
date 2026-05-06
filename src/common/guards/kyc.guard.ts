import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { KycTier } from "src/modules/users/entities/user.entity";

export const REQUIRED_KYC_TIER = 'requiredKycTier';

export const RequiredKycTier = (tier: KycTier) => SetMetadata(REQUIRED_KYC_TIER, tier);

@Injectable()
export class KycGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredTier = this.reflector.getAllAndOverride<KycTier>(REQUIRED_KYC_TIER, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (requiredTier === undefined) return true;

        const { user } = context.switchToHttp().getRequest();
        if ( !user ) throw new ForbiddenException('Authentication required');

        if (user.kycTier < requiredTier) {
            throw new ForbiddenException(
                `This action requires KYC Tier ${requiredTier}. Your current tier is ${user.kycTier}. Please complete identity verification.`,
            );
        }

        return true;
    }
}