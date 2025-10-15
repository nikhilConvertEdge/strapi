import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { ContentManagerService } from './content-manager.service';

@Controller('/content-manager/:collection')
export class ContentManagerController {
  constructor(private readonly service: ContentManagerService) { }

  @Post()
  create(@Param('collection') collection: string, @Body() body: any) {
    return this.service.create(collection, body);
  }

  @Get('/:id')
  async findOne(
    @Param('collection') collection: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const entity = await this.service.findOne(collection, id);
    return { success: true, data: entity };
  }
}
