import { Module } from '@nestjs/common';
import { ContentManagerController, } from './content-manager.controller';
import { ContentManagerService, } from './content-manager.service';

@Module({
    providers: [ContentManagerService],
    controllers: [ContentManagerController],
})
export class ContentManagerModule { }
