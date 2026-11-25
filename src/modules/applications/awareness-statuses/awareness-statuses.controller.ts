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
import { AwarenessStatusesService } from './awareness-statuses.service';

@Controller('awareness-statuses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AwarenessStatusesController {
  constructor(private readonly awarenessStatusesService: AwarenessStatusesService) {}

  @Get()
  findAll(@Query('include_inactive') includeInactive?: string) {
    return this.awarenessStatusesService.findAll(includeInactive === 'true');
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
      is_informed?: boolean;
      source_channel?: string | null;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.awarenessStatusesService.create(body);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      code?: string | null;
      is_informed?: boolean;
      source_channel?: string | null;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.awarenessStatusesService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.awarenessStatusesService.remove(id);
  }
}
