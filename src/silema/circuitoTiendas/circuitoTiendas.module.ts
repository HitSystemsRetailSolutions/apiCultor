import { Module } from '@nestjs/common';
import { salesSilemaController } from './salesSilema.controller';
import { salesSilemaService } from './salesSilema.service';
import { salesSilemaCierreController } from './salesSilemaCierre.controller';
import { salesSilemaCierreService } from './salesSilemaCierre.service';
import { salesSilemaAbonoController } from './salesSilemaAbono.controller';
import { salesSilemaAbonoService } from './salesSilemaAbono.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { HelpersModule } from 'src/helpers/helpers.module';

@Module({
    imports: [ConnectionModule, HelpersModule],
    controllers: [
        salesSilemaController,
        salesSilemaCierreController,
        salesSilemaAbonoController,
    ],
    providers: [
        salesSilemaService,
        salesSilemaCierreService,
        salesSilemaAbonoService,
    ],
})
export class CircuitoTiendasModule { }
