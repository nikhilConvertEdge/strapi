import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { ContentTypeBuilderService } from './content-type-builder.service';

@Controller('schema')
export class ContentTypeBuilderController {
  constructor(
    private readonly contentTypeBuilderService: ContentTypeBuilderService,
  ) { }

  @Post('create-content-type')
  async createContentType(@Body() schema: any) {
    return await this.contentTypeBuilderService.createContentType(schema);
  }

  @Post('update-content-type')
  async updateContentType(@Body() schema: any) {
    return await this.contentTypeBuilderService.updateContentType(schema);
  }

  @Post('create-component')
  async createComponent(@Body() body: any) {
    return await this.contentTypeBuilderService.createComponent(body);
  }

  @Post('update-component')
  async updateComponent(@Body() body: any) {
    return await this.contentTypeBuilderService.updateComponent(body);
  }

  @Get('schemas')
  async findAllSchemas() {
    return await this.contentTypeBuilderService.findAllSchemas();
  }

  @Get('schemas/:collectionName')
  async findOneSchema(@Param('collectionName') collectionName: string) {
    return await this.contentTypeBuilderService.findOneSchema(collectionName);
  }
}
