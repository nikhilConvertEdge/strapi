import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentManagerModule, } from './content-manager/content-manager.module';
import { ContentTypeBuilderModule } from './content-type-builder/content-type-builder.module';
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: '127.0.0.1',          // your host
      port: 5432,                 // default PostgreSQL port
      username: 'postgres',       // your PostgreSQL username
      password: '1234',  // your PostgreSQL password
      database: 'dynamic_db',     // database name
      synchronize: false,         // we will create tables dynamically
      logging: true,
      poolSize: 20,
      extra: {
        max: 10, // <= maximum connections allowed
      },
    }),
    ContentTypeBuilderModule,
    ContentManagerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
