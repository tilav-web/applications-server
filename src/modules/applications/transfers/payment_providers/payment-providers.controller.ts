import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../../../../common/decorators/roles.decorator';
import { Role } from '../../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { normalizePagination } from '../../../../common/utils/pagination.util';
import { CreatePaymentProviderDto } from './dto/create-payment-provider.dto';
import { UpdatePaymentProviderDto } from './dto/update-payment-provider.dto';
import { PaymentProvidersService } from './payment-providers.service';

@Controller('payment-providers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentProvidersController {
  constructor(private readonly paymentProvidersService: PaymentProvidersService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  create(@Body() dto: CreatePaymentProviderDto) {
    return this.paymentProvidersService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    const pagination = normalizePagination(page, limit, 50);
    return this.paymentProvidersService.findAll(pagination.page, pagination.limit, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentProvidersService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  update(@Param('id') id: string, @Body() dto: UpdatePaymentProviderDto) {
    return this.paymentProvidersService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  remove(@Param('id') id: string) {
    return this.paymentProvidersService.remove(id);
  }
}
