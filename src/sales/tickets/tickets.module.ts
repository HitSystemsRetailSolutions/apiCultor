import { Module } from '@nestjs/common';
import { ticketsController } from './tickets.controller';
import { ticketsService } from './tickets.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { MaestrosModule } from 'src/maestros/maestros.module';
import { InvoicesModule } from 'src/sales/invoices/invoices.module';

@Module({
    imports: [ConnectionModule, MaestrosModule, InvoicesModule],
    controllers: [ticketsController],
    providers: [ticketsService],
    exports: [ticketsService],
})
export class TicketsModule { }
