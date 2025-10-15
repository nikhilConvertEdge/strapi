import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('schema')
export class AppController {
  constructor(private readonly appService: AppService) { }
}
