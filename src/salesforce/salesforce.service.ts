import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';

export interface SalesforceUser {
  Id: string;
  PortalId__c: string;
}

export interface SalesforceMerchant {
  Id: string;
  MerchantID__c: string;
  ProcessorName__c: string;
}

export interface Top10UpdatePayload {
  userId: string;
  top10Merchants: { merchantId: string, totalVolume: number }[];
}


@Injectable()
export class SalesForceService {
  private readonly logger = new Logger(SalesForceService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenUrl: string;
  private readonly baseUrl: string;

  private accessToken: string | null = null;
  private tokenExpiryTime: number = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.clientId = this.configService.getOrThrow<string>('SALESFORCE_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('SALESFORCE_CLIENT_SECRET');
    this.tokenUrl = this.configService.getOrThrow<string>('SALESFORCE_AUTH_URL');
    this.baseUrl = this.configService.getOrThrow<string>('SALESFORCE_BASE_URL');
  }
  
  private async authenticate(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiryTime) {
      return;
    }
    this.logger.log('Authenticating with Salesforce...');
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);
      const response = await firstValueFrom(
        this.httpService.post<{ access_token: string }>(this.tokenUrl, params),
      );
      this.accessToken = response.data.access_token;
      this.tokenExpiryTime = Date.now() + (55 * 60 * 1000);
      this.logger.log('Successfully authenticated with Salesforce.');
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error('Salesforce Auth Error:', axiosError.response?.data || axiosError.message);
      throw new InternalServerErrorException('Salesforce authentication failed');
    }
  }

  private async callApi<T>(path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: Record<string, any>): Promise<T> {
    await this.authenticate();
    const url = `${this.baseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.request<T>({
          url,
          method,
          data: body,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(`Salesforce API Error on ${method} ${url}:`, axiosError.response?.data || axiosError.message);
      throw error;
    }
  }

  async getAllUsers(): Promise<SalesforceUser[]> {
    const path = '/services/apexrest/v1/users/list/';
    return this.callApi<SalesforceUser[]>(path, 'GET');
  }
  
  async getMerchantsForUser(portalId: string): Promise<SalesforceMerchant[]> {
    const path = '/services/apexrest/v1/merchants/list/';
    return this.callApi<SalesforceMerchant[]>(path, 'POST', { portalId });
  }
  
  async bulkUpdateTop10Merchants(data: Top10UpdatePayload[]): Promise<any> {
    const path = `/services/apexrest/v1/analytics/topMerchants/`;
    const result: any = await this.callApi(path, 'PATCH', { updates: data });
    return result;
  }
}