import { Module } from '@nestjs/common';
import { ContentTypeController } from './content-type.controller';
import { ContentTypeService } from './content-type.service';
import { ComponentModule } from 'src/component/component.module';
import { ComponentService } from 'src/component/component.service';


@Module({
    imports: [
        ComponentModule
    ],
    providers: [ContentTypeService, ComponentService],
    controllers: [ContentTypeController],
})
export class ContentTypeModule { }
