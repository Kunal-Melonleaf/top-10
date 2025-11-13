import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ProcessorFactory } from './processor.factory';
import { IrisCrmService } from './iriscrm.service';
import { PayrocService } from './payroc.service';
import { PayrocAuthService } from './payroc-auth.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [
    ProcessorFactory,
    IrisCrmService,
    PayrocService,
    PayrocAuthService,
  ],
  exports: [ProcessorFactory],
})
export class ProcessorModule {}