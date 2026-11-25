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

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ExternalSystemsService } from './external-systems.service';

@Controller('external-systems')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExternalSystemsController {
  constructor(private readonly externalSystemsService: ExternalSystemsService) {}

  @Get()
  findAll(@Query('include_inactive') includeInactive?: string) {
    return this.externalSystemsService.findAll(includeInactive === 'true');
  }

  @Post()
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.STAFF,
    Role.INSPECTOR,
    Role.DISTRICT_OFFICER,
    Role.OPERATOR,
  )
  create(
    @Body()
    body: {
      name: string;
      code?: string | null;
      description?: string | null;
      color?: string | null;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.externalSystemsService.create(body);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      code?: string | null;
      description?: string | null;
      color?: string | null;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.externalSystemsService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.externalSystemsService.remove(id);
  }
}
