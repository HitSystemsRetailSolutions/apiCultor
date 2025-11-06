import { Module } from '@nestjs/common';
import { noSerieController } from './noSerie.controller';
import { noSerieService } from './noSerie.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [noSerieController],
    providers: [noSerieService],
    exports: [noSerieService],
})
export class noSerieModule { }
