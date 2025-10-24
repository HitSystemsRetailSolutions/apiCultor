import { Module } from '@nestjs/common';
import { xmlController } from './xml.controller';
import { xmlService } from './xml.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [xmlController],
    providers: [xmlService],
})
export class xmlModule { }
