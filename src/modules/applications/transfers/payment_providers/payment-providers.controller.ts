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

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CreatePaymentProviderDto } from './dto/create-payment-provider.dto';
import { UpdatePaymentProviderDto } from './dto/update-payment-provider.dto';
import { PaymentProvidersService } from './payment-providers.service';

@Controller('payment-providers')
@UseGuards(JwtAuthGuard)
export class PaymentProvidersController {
  constructor(private readonly paymentProvidersService: PaymentProvidersService) {}

  @Post()
  create(@Body() dto: CreatePaymentProviderDto) {
    return this.paymentProvidersService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.paymentProvidersService.findAll(Number(page) || 1, Number(limit) || 50, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentProvidersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePaymentProviderDto) {
    return this.paymentProvidersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.paymentProvidersService.remove(id);
  }
}
