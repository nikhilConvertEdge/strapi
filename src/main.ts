// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppService } from './app.service';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await app.listen(3000);
  console.log('✅ All tables created from schema files!');
  console.log('🚀 Server started on http://localhost:3000');
}

bootstrap();
