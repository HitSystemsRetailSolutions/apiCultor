import { Module } from '@nestjs/common';
import { documentAttachmentsService } from './documentAttachments.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    providers: [documentAttachmentsService],
    exports: [documentAttachmentsService],
})
export class documentAttachmentsModule { }
