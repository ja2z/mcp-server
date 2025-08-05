import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export interface SigmaApiConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface SigmaDocument {
  id: string;
  name: string;
  description?: string;
  type: 'workbook' | 'dataset';
  createdAt: string;
  updatedAt: string;
  url: string;
  tags?: string[];
  elements?: SigmaElement[];
}

export interface SigmaElement {
  id: string;
  name: string;
  type: string;
  description?: string;
}

export class SigmaApiClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;
  private tokenExpiry?: Date;

  constructor(config: SigmaApiConfig) {
    this.baseUrl = config.baseUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  async initialize() {
    // Load credentials from AWS Secrets Manager in production
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      await this.loadCredentialsFromSecretsManager();
    }
    
    // Get initial access token
    await this.refreshAccessToken();
  }

  private async loadCredentialsFromSecretsManager() {
    const secretsClient = new SecretsManagerClient({});
    
    try {
      const response = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: "sigma-api-credentials",
        })
      );

      if (response.SecretString) {
        const credentials = JSON.parse(response.SecretString);
        this.clientId = credentials.clientId;
        this.clientSecret = credentials.clientSecret;
      }
    } catch (error) {
      console.error("Failed to load credentials from Secrets Manager:", error);
      throw error;
    }
  }

  private async refreshAccessToken() {
    const response = await fetch(`${this.baseUrl}/v2/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    
    // Set expiry to 90% of the actual expiry time to refresh early
    const expiresIn = data.expires_in * 0.9;
    this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);
  }

  private async ensureValidToken() {
    if (!this.accessToken || !this.tokenExpiry || this.tokenExpiry <= new Date()) {
      await this.refreshAccessToken();
    }
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    await this.ensureValidToken();

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  async listWorkbooks(): Promise<SigmaDocument[]> {
    const response = await this.makeRequest('/v2/workbooks');
    const data = await response.json();
    
    return data.entries?.map((workbook: any) => ({
      id: workbook.workbookId,
      name: workbook.name,
      description: workbook.description,
      type: 'workbook' as const,
      createdAt: workbook.createdAt,
      updatedAt: workbook.updatedAt,
      url: workbook.url,
      tags: workbook.tags,
    })) || [];
  }

  async listDatasets(): Promise<SigmaDocument[]> {
    const response = await this.makeRequest('/v2/datasets');
    const data = await response.json();
    
    return data.entries?.map((dataset: any) => ({
      id: dataset.datasetId,
      name: dataset.name,
      description: dataset.description,
      type: 'dataset' as const,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt,
      url: dataset.url,
      tags: dataset.tags,
    })) || [];
  }

  async getWorkbookDetails(workbookId: string): Promise<SigmaDocument> {
    const response = await this.makeRequest(`/v2/workbooks/${workbookId}`);
    const workbook = await response.json();

    // Get workbook elements
    const elementsResponse = await this.makeRequest(`/v2/workbooks/${workbookId}/pages`);
    const pagesData = await elementsResponse.json();
    
    const elements: SigmaElement[] = [];
    for (const page of pagesData.entries || []) {
      const pageElementsResponse = await this.makeRequest(`/v2/workbooks/${workbookId}/pages/${page.pageId}/elements`);
      const pageElements = await pageElementsResponse.json();
      
      elements.push(...(pageElements.entries?.map((element: any) => ({
        id: element.elementId,
        name: element.name || element.elementId,
        type: element.type,
        description: element.description,
      })) || []));
    }

    return {
      id: workbook.workbookId,
      name: workbook.name,
      description: workbook.description,
      type: 'workbook',
      createdAt: workbook.createdAt,
      updatedAt: workbook.updatedAt,
      url: workbook.url,
      tags: workbook.tags,
      elements,
    };
  }

  async exportData(workbookId: string, elementId: string, format: 'csv' | 'json' = 'json'): Promise<string> {
    const response = await this.makeRequest(`/v2/workbooks/${workbookId}/elements/${elementId}/data`, {
      method: 'POST',
      body: JSON.stringify({
        format: format,
        limit: 1000, // Configurable limit for prototype
      }),
    });

    if (format === 'json') {
      const data = await response.json();
      return JSON.stringify(data, null, 2);
    } else {
      return await response.text();
    }
  }

  // Heartbeat method to test API connectivity
  async whoami(): Promise<any> {
    const response = await this.makeRequest('/v2/auth/whoami');
    return await response.json();
  }

  // Placeholder method - implement based on Sigma's actual search API
  async searchDocuments(query: string): Promise<SigmaDocument[]> {
    // This would use Sigma's search API when available
    // For now, we'll rely on the cached search functionality
    throw new Error("Direct API search not implemented - use cached search instead");
  }
}