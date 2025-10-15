import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ContentManagerModule } from './content-manager/content-manager.module';
import { ContentTypeBuilderModule } from './content-type-builder/content-type-builder.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.dev.env' }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: config.get<'postgres'>('DB_TYPE'),
        host: config.get<string>('DB_HOST'),
        port: parseInt(config.get<string>('DB_PORT')),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE'),
        synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
        logging: config.get<string>('DB_LOGGING') === 'true',
        poolSize: parseInt(config.get<string>('DB_POOL_SIZE')),
        extra: {
          max: parseInt(config.get<string>('DB_EXTRA_MAX')),
        },
      }),
    }),
    ContentTypeBuilderModule,
    ContentManagerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
