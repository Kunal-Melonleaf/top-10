import { Processor, WorkerHost } from '@nestjs/bullmq'; // FIX: Updated import
import { Job } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.provider';

interface FinalizationJobData { userId: string; portalId: string; merchantIds: string[]; merchantNameMap: Record<string, string>;}

@Processor('finalization')
export class FinalizationProcessor extends WorkerHost { // FIX: Extend WorkerHost
  private readonly logger = new Logger(FinalizationProcessor.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super(); 
    this.logger.log(' FinalizationProcessor initialized!');
  }

  async process(job: Job<FinalizationJobData>): Promise<any> {
    const { userId, portalId, merchantIds, merchantNameMap } = job.data;
    const lockKey = `analytics-status:${userId}`;
    
      this.logger.log(`🚀 FINALIZATION STARTED for User ID: ${userId} (Portal: ${portalId})`);

    try {
      if (merchantIds.length === 0) {
        await this.redis.set(lockKey, 'completed');
        return;
      }

      const volumeKeys = merchantIds.map(id => `merchant-volume:${id}`);
      const countKeys = merchantIds.map(id => `merchant-count:${id}`);

      const [volumes, counts] = await Promise.all([
        this.redis.mget(...volumeKeys),
        this.redis.mget(...countKeys),
      ]);

      const results = merchantIds
        .map((id, index) => ({
          merchantId: id,
          merchantName: merchantNameMap[id] || 'Unknown',
          totalVolume: parseFloat(volumes[index] || '0') || 0,
          totalCount: parseInt(counts[index] || '0', 10) || 0,
        }))
        .sort((a, b) => b.totalVolume - a.totalVolume)
        .slice(0, 10);

       const updatePayload = { userId, portalId, top10Merchants: results };
      await this.redis.lpush('salesforce-update-batch', JSON.stringify(updatePayload));
      await this.redis.set(lockKey, 'completed');
      
      this.logger.log(`Successfully finalized and queued results for User ID ${userId}.`);
    } catch (error) {
      this.logger.error(`Failed to finalize analytics for User ID: ${userId}`, error);
      await this.redis.set(lockKey, 'failed');
      throw error;
    }
  }
}