import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('schema')
export class AppController {
  constructor(private readonly appService: AppService) { }


  @Post('create-content-type')
  async createTable(@Body() schema: any) {
    await this.appService.createTableFromSchema(schema);
    return { message: `Table created successfully` };
  }

  @Post('update-content-type')
  async updateContentType(@Body() schema: any) {
    await this.appService.updateContentType(schema);
    return { message: `Content-type '${schema.collectionName}' updated successfully` };
  }


  @Post('create-component')
  async createComponentTable(@Body() body: any) {
    const { collectionName, attributes } = body;
    await this.appService.createComponentTable(collectionName, body);
    return { message: `Component table created for ${collectionName}` };
  }

  @Post('update-component')
  async updateComponent(@Body() body: any) {
    const { collectionName, attributes } = body;
    await this.appService.updateComponentTable(collectionName, body);
    return { message: `Component table updated for ${collectionName}` };
  }


}
