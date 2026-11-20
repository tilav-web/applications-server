import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({
    default: {
      limit: 5,
      ttl: 60000,
    },
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.authService.login(dto, res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser('sub') authId: string) {
    return this.authService.getProfile(authId);
  }

  @Put('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@CurrentUser('sub') authId: string, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(authId, dto);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async patchMe(@CurrentUser('sub') authId: string, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(authId, dto);
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@CurrentUser('sub') authId: string, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(authId, dto);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async patchProfile(@CurrentUser('sub') authId: string, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(authId, dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = (req.cookies as Record<string, string> | undefined)?.['refresh_token'];
    if (!refreshToken) {
      throw new UnauthorizedException('Sessiya muddati tugagan, iltimos qaytadan kiring');
    }
    const { accessToken } = await this.authService.refreshTokens(refreshToken, res);
    return { access_token: accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request & { user?: JwtAccessPayload },
    @Res({ passthrough: true }) res: Response,
  ) {
    const authId = await this.authService.resolveAuthIdFromRequest(req);
    return this.authService.logout(authId, res);
  }
}
