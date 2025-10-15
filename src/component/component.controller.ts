import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
} from '@nestjs/common';
import { ComponentService } from './component.service';

@Controller('api/component/:collection')
export class ComponentController {
    constructor(private readonly service: ComponentService) { }

    @Post()
    createComponent(@Param('collection') collection: string, @Body() body: any) {
        return this.service.createComponent(collection, body);
    }
}
