import { Module } from '@nestjs/common';
import { itemsController } from './items.controller';
import { itemsService } from './items.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { VendorsModule } from 'src/maestros/vendors/vendors.module';

@Module({
    imports: [ConnectionModule, VendorsModule],
    controllers: [itemsController],
    providers: [itemsService],
    exports: [itemsService],
})
export class ItemsModule { }
