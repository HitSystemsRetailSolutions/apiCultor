import { Module } from '@nestjs/common';
import { IncidenciaController } from './incidencia.controller';
import { IncidenciaService } from './incidencia.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [IncidenciaController],
    providers: [IncidenciaService],
})
export class IncidenciasModule { }