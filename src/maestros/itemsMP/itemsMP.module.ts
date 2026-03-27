import { Module } from '@nestjs/common';
import { itemsMPController } from './itemsMP.controller';
import { itemsMPService } from './itemsMP.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { VendorsModule } from 'src/maestros/vendors/vendors.module';

@Module({
    imports: [ConnectionModule, VendorsModule],
    controllers: [itemsMPController],
    providers: [itemsMPService],
    exports: [itemsMPService],
})
export class ItemsMPModule { }
