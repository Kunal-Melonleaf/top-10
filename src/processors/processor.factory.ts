
import { Injectable, NotFoundException } from '@nestjs/common';
import { IProcessorService } from './iprocessor.service';
import { PayrocService } from './payroc.service';
import { IrisCrmService } from './iriscrm.service';

@Injectable()
export class ProcessorFactory {
  constructor(
    private readonly payrocService: PayrocService,
    private readonly irisCrmService: IrisCrmService,
  ) {}

  public getService(processorName: string): IProcessorService {
    const name = (processorName || '').toLowerCase();

    if (name.includes('payroc')) return this.payrocService;
    if (name.includes('argyle') || name.includes('merchant lynx')) return this.irisCrmService;
    
    throw new NotFoundException(`Processor integration not found for: ${processorName}`);
  }
}