import { Module } from '@nestjs/common';
import { ContentTypeBuilderController } from './content-manager.controller';
import { ContentTypeBuilderService } from './content-type-builder.service';


@Module({
    providers: [ContentTypeBuilderService],
    controllers: [ContentTypeBuilderController],
})
export class ContentTypeBuilderModule { }
