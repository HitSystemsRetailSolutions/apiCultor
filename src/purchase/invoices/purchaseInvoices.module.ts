import { Module } from '@nestjs/common';
import { purchaseInvoicesController } from './purchaseInvoices.controller';
import { purchaseInvoicesService } from './purchaseInvoices.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { MaestrosModule } from 'src/maestros/maestros.module';
import { noSerieModule } from 'src/sales/noSerie/noSerie.module';

@Module({
    imports: [ConnectionModule, MaestrosModule, noSerieModule],
    controllers: [purchaseInvoicesController],
    providers: [purchaseInvoicesService],
    exports: [purchaseInvoicesService],
})
export class PurchaseInvoicesModule { }
