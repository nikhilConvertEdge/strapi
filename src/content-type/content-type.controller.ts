import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { ContentTypeService } from './content-type.service';

@Controller('api/content-type/:collection')
export class ContentTypeController {
  constructor(private readonly service: ContentTypeService) { }

  @Post()
  create(@Param('collection') collection: string, @Body() body: any) {
    return this.service.create(collection, body);
  }


  @Get('/:id')
  async findOne(
    @Param('collection') collection: string, // get collection from URL
    @Param('id', ParseIntPipe) id: number,
  ) {
    const entity = await this.service.findOne(collection, id);
    return { success: true, data: entity };
  }
}
