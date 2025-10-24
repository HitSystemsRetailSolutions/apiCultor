import { Module } from '@nestjs/common';
import { traspasosController } from './traspasos.controller';
import { traspasosService } from './traspasos.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [traspasosController],
    providers: [traspasosService],
})
export class TraspasosModule { }
