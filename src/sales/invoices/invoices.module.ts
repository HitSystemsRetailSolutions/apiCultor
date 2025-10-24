import { Module } from '@nestjs/common';
import { invoicesController } from './invoices.controller';
import { invoicesService } from './invoices.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { MaestrosModule } from 'src/maestros/maestros.module';

@Module({
    imports: [ConnectionModule, MaestrosModule],
    controllers: [invoicesController],
    providers: [invoicesService],
    exports: [invoicesService],
})
export class InvoicesModule { }
