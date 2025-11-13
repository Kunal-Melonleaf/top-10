import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import { ProcessorFactory } from '../../processors/processor.factory';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.provider';

interface MerchantJobData { merchantId: string; processorName: string; }



@Processor('merchant-analytics')
export class MerchantAnalyticsProcessor {
  private readonly logger = new Logger(MerchantAnalyticsProcessor.name);
  
  constructor(
    private readonly processorFactory: ProcessorFactory,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Process('process-merchant')
  async processMerchantJob(job: Job<MerchantJobData>) {
    const { merchantId, processorName } = job.data;
    this.logger.log(`Processing merchant: ${merchantId} (${processorName})`);

    try {
      const processorService = this.processorFactory.getService(processorName);
      const lastUpdatedKey = `merchant-volume-last-updated:${merchantId}`;
      const volumeKey = `merchant-volume:${merchantId}`;
      const countKey = `merchant-count:${merchantId}`;
      
      const lastUpdated = await this.redis.get(lastUpdatedKey);
      
      
      const { netVolume, transactionCount } = await processorService.calculateVolumeAndCount(
        merchantId,
        processorName, 
        { from: lastUpdated },
      );

      if (netVolume !== 0) {
        await this.redis.incrbyfloat(volumeKey, netVolume);
      }
      if (transactionCount !== 0) {
        await this.redis.incrby(countKey, transactionCount);
      }
      
      await this.redis.set(lastUpdatedKey, new Date().toISOString());
      this.logger.log(`Finished processing merchant ${merchantId}. Added Volume: ${netVolume}, Count: ${transactionCount}`);
    } catch (error) {
      this.logger.error(`Failed to process merchant ${merchantId}`, error);
      throw error;
    }
  }
}