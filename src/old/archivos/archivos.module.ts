import { Module } from '@nestjs/common';
import { archivosController } from './archivos.controller';
import { archivosService } from './archivos.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [archivosController],
    providers: [archivosService],
})
export class ArchivosModule { }
