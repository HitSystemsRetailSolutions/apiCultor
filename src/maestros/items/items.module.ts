import { Module } from '@nestjs/common';
import { itemsController } from './items.controller';
import { itemsService } from './items.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [itemsController],
    providers: [itemsService],
    exports: [itemsService],
})
export class ItemsModule { }
