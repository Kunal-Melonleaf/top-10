import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

interface PayrocToken { accessToken: string; expiryTime: number; }
interface PayrocAuthResponse { access_token: string; expires_in: number; }

@Injectable()
export class PayrocAuthService {
  private readonly logger = new Logger(PayrocAuthService.name);
  private readonly tokenCache = new Map<string, PayrocToken>();
  private readonly authUrl = 'https://identity.payroc.com/authorize';

  constructor(private readonly httpService: HttpService) {}

  async getAccessToken(officeCode: string, apiKey: string): Promise<string> {
    const cachedToken = this.tokenCache.get(officeCode);
    if (cachedToken && Date.now() < cachedToken.expiryTime) {
      return cachedToken.accessToken;
    }
    return this.fetchNewAccessToken(officeCode, apiKey);
  }

  private async fetchNewAccessToken(officeCode: string, apiKey: string): Promise<string> {
    this.logger.debug(`Fetching new token for Payroc office code: ${officeCode}`);
    try {
      const response = await firstValueFrom(
        this.httpService.post<PayrocAuthResponse>(
          this.authUrl,
          '', // Empty string body
          { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' } },
        ),
      );

      const { access_token, expires_in } = response.data;
      const expiryTime = Date.now() + (expires_in - 60) * 1000;
      this.tokenCache.set(officeCode, { accessToken: access_token, expiryTime });
      this.logger.debug(`Successfully fetched and cached new token for office code: ${officeCode}`);
      return access_token;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(`FAILED to fetch Payroc access token for office code ${officeCode}. Status: ${axiosError.response?.status}`, axiosError.response?.data);
      throw new InternalServerErrorException(`Payroc authentication failed for office code ${officeCode}`);
    }
  }
}