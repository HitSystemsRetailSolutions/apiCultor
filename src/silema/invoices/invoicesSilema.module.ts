import { Module } from '@nestjs/common';
import { intercompanySilemaController } from './intercompanySilema.controller';
import { intercompanySilemaService } from './intercompanySilema.service';
import { salesSilemaRecapController } from './salesSilemaRecap.controller';
import { salesSilemaRecapService } from './salesSilemaRecap.service';
import { salesSilemaRecapManualController } from './salesSilemaRecapManual.controller';
import { salesSilemaRecapManualService } from './salesSilemaRecapManual.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [
        intercompanySilemaController,
        salesSilemaRecapController,
        salesSilemaRecapManualController,
    ],
    providers: [
        intercompanySilemaService,
        salesSilemaRecapService,
        salesSilemaRecapManualService,
    ],
})
export class InvoicesSilemaModule { }