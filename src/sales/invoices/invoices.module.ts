import { Module } from '@nestjs/common';
import { invoicesController } from './invoices.controller';
import { invoicesService } from './invoices.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { MaestrosModule } from 'src/maestros/maestros.module';
import { PdfModule } from 'src/pdf/pdf.module';
import { xmlModule } from '../xml/xml.module';
import { noSerieModule } from '../noSerie/noSerie.module';
import { verifactuModule } from '../verifactu/verifactu.module';

@Module({
    imports: [ConnectionModule, MaestrosModule, PdfModule, xmlModule, noSerieModule, verifactuModule],
    controllers: [invoicesController],
    providers: [invoicesService],
    exports: [invoicesService],
})
export class InvoicesModule { }
