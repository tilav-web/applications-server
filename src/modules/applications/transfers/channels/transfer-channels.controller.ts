import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../../../../common/decorators/roles.decorator';
import { Role } from '../../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { CreateTransferChannelDto } from './dto/create-transfer-channel.dto';
import { TransferChannelsService } from './transfer-channels.service';

@Controller('transfer-channels')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransferChannelsController {
  constructor(private readonly channelsService: TransferChannelsService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.channelsService.findAll(Number(page) || 1, Number(limit) || 100, search);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.channelsService.findOne(id);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  create(@Body() dto: CreateTransferChannelDto) {
    return this.channelsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Partial<CreateTransferChannelDto>) {
    return this.channelsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.channelsService.remove(id);
  }
}
