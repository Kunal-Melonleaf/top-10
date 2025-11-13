import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { IProcessorService, VolumeAndCount, PayrocRawBatch } from './iprocessor.service';
import { PayrocAuthService } from './payroc-auth.service';
import { AxiosError } from 'axios';

interface PayrocBatchParams {
  merchantId: string;
  date: string;
  limit: number;
  after?: number; 
}

@Injectable()
export class PayrocService implements IProcessorService {
  private readonly logger = new Logger(PayrocService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly payrocAuthService: PayrocAuthService,
  ) {
     const baseUrl = this.configService.get<string>('PAYROC_BASE_URL'); // or PAYROC_BASE_URL
    if (!baseUrl) {
        throw new Error('Required configuration PAYROC_BASE_URL is missing.'); // or PAYROC_BASE_URL
    }
    this.baseUrl = baseUrl;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private getPayrocConfig(processorName: string): { officeCode: string; apiKey: string } {
    const match = processorName.toLowerCase().match(/\s(\d+)$/);
    if (!match) {
      throw new NotFoundException(`Could not parse office code from processor: "${processorName}"`);
    }
    const officeCode = match[1];

    const apiKeyEnvVar = `PAYROC_${officeCode}_API_TOKEN_B64`;
    const base64ApiKey = this.configService.get<string>(apiKeyEnvVar);
    if (!base64ApiKey) {
      throw new NotFoundException(`API Key config not found for Payroc office code: ${officeCode}`);
    }

    const apiKey = Buffer.from(base64ApiKey, 'base64').toString('utf8');
    return { officeCode, apiKey };
  }

  async calculateVolumeAndCount(
    merchantId: string,
    processorName: string,
    dateScope: { from: string | null },
  ): Promise<VolumeAndCount> {
    const { officeCode, apiKey } = this.getPayrocConfig(processorName);
    this.logger.log(`Calculating Payroc volume for merchant ${merchantId} (${officeCode}) since ${dateScope.from || 'the beginning'}`);
    
    let totalNetVolume = 0;
    let totalTransactionCount = 0;
    
    const startDate = dateScope.from ? new Date(dateScope.from) : new Date('2020-01-01');
    const endDate = new Date();

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const currentDate = this.formatDate(d);
      let hasMore = true;
      let afterCursor: number | null = null;
      const accessToken = await this.payrocAuthService.getAccessToken(officeCode, apiKey);
      
      while (hasMore) {
       const params: PayrocBatchParams = { merchantId, date: currentDate, limit: 100 };
        if (afterCursor) params.after = afterCursor;

        try {
            const response = await firstValueFrom(
              this.httpService.get<{ data: PayrocRawBatch[], hasMore: boolean }>(`${this.baseUrl}/v1/batches`, {
                headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
                params,
              }),
            );
            const batches = response.data.data;
    
            if (batches?.length > 0) {
              for (const batch of batches) {
                totalNetVolume += (batch.saleAmount || 0) - (batch.returnAmount || 0);
                totalTransactionCount += batch.transactionCount || 0;
              }
              afterCursor = batches[batches.length - 1].batchId;
            }
            
            hasMore = response.data.hasMore;

        } catch(error) {
            const axiosError = error as AxiosError;
            this.logger.error(`Failed to fetch Payroc batches for merchant ${merchantId} on date ${currentDate}`, axiosError.response?.data);
            throw error; 
        }
      }
    }

    return {
      netVolume: totalNetVolume / 100, // Convert cents to dollars
      transactionCount: totalTransactionCount,
    };
  }
}