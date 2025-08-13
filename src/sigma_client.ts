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

export interface DocumentAnalytics {
  interactions: number;
  interactionsPercentile: number;
  opens: number;
  opensPercentile: number;
  publishes: number;
  publishesPercentile: number;
  users: number;
  accountType: string;
  daysSinceLastActivity: number;
  daysWithActivity: number;
  daysWithActivityPercentile: number;
  details: string;
  docCreatedAt: string;
  docCreatedByEmail: string;
  docCreatedByName: string;
  documentName: string;
  documentType: string;
  firstActivity: string;
  lastActivity: string;
  lastOpenedOn: string;
  lastInteractedOn?: string;
  lastPublishedOn?: string;
  versionTag: string;
}

export interface ExportRequest {
  format: {
    type: 'jsonl' | 'json' | 'csv';
  };
  elementId: string;
  parameters?: {
    [key: string]: string;
  };
}

export interface ExportResponse {
  queryId: string;
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
    const tokenUrl = `${this.baseUrl}/v2/auth/token`;
    console.log(`🔍 [DEBUG] refreshAccessToken called`);
    console.log(`🔍 [DEBUG] Requesting access token from: ${tokenUrl}`);
    console.log(`🔍 [DEBUG] Client ID: ${this.clientId ? '***' + this.clientId.slice(-4) : 'NOT_SET'}`);
    console.log(`🔍 [DEBUG] Client Secret: ${this.clientSecret ? '***' + this.clientSecret.slice(-4) : 'NOT_SET'}`);
    
    try {
      const response = await fetch(tokenUrl, {
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

      console.log(`🔍 [DEBUG] Token response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        console.log(`❌ [DEBUG] Token error response: ${errorText}`);
        throw new Error(`Failed to get access token: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      console.log(`✅ [DEBUG] Access token received: ${this.accessToken ? '***' + this.accessToken.slice(-10) : 'NOT_SET'}`);
      
      // Set expiry to 90% of the actual expiry time to refresh early
      const expiresIn = data.expires_in * 0.9;
      this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);
      console.log(`🔍 [DEBUG] Token expiry set to: ${this.tokenExpiry.toISOString()}`);
    } catch (error) {
      console.log(`❌ [DEBUG] refreshAccessToken failed:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async ensureValidToken() {
    console.log(`🔍 [DEBUG] ensureValidToken called`);
    console.log(`🔍 [DEBUG] Current token state:`, {
      hasToken: !!this.accessToken,
      tokenExpiry: this.tokenExpiry?.toISOString(),
      currentTime: new Date().toISOString(),
      needsRefresh: !this.accessToken || !this.tokenExpiry || this.tokenExpiry <= new Date()
    });
    
    if (!this.accessToken || !this.tokenExpiry || this.tokenExpiry <= new Date()) {
      console.log(`🔍 [DEBUG] Token needs refresh, calling refreshAccessToken...`);
      await this.refreshAccessToken();
      console.log(`✅ [DEBUG] Token refreshed successfully`);
    } else {
      console.log(`✅ [DEBUG] Token is still valid`);
    }
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    console.log(`🔍 [DEBUG] makeRequest called with endpoint: ${endpoint}`);
    console.log(`🔍 [DEBUG] Request options:`, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body ? 'BODY_PRESENT' : 'NO_BODY'
    });
    
    await this.ensureValidToken();

    const url = `${this.baseUrl}${endpoint}`;
    console.log(`🔍 [DEBUG] Making request to: ${url}`);
    console.log(`🔍 [DEBUG] Using access token: ${this.accessToken ? '***' + this.accessToken.slice(-10) : 'NOT_SET'}`);
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      console.log(`🔍 [DEBUG] Response status: ${response.status} ${response.statusText}`);
      console.log(`🔍 [DEBUG] Response headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        console.log(`❌ [DEBUG] Error response body: ${errorText}`);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      console.log(`✅ [DEBUG] Request successful`);
      return response;
    } catch (error) {
      console.log(`❌ [DEBUG] makeRequest failed:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
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

  /**
   * Initiate a data export (generic version)
   */
  async initiateDataExport(workbookId: string, elementId: string, format: 'csv' | 'json' = 'json', parameters?: { [key: string]: string }): Promise<string> {
    const exportRequest: ExportRequest = {
      format: {
        type: format === 'json' ? 'json' : 'csv'
      },
      elementId
    };

    // Add parameters if provided
    if (parameters) {
      exportRequest.parameters = parameters;
    }

    const response = await this.makeRequest(`/v2/workbooks/${workbookId}/export`, {
      method: 'POST',
      body: JSON.stringify(exportRequest),
    });

    const data: ExportResponse = await response.json();
    return data.queryId;
  }

  /**
   * Poll for export completion and download data (generic version)
   */
  async pollForDataExportCompletion(queryId: string, format: 'csv' | 'json' = 'json', maxAttempts: number = 30): Promise<string> {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Polling for data export completion, attempt ${attempt}/${maxAttempts}`);
        
        const data = await this.downloadDataExport(queryId, format);
        if (data) {
          console.log(`Data export completed successfully after ${attempt} attempts`);
          return data;
        }
      } catch (error) {
        console.log(`Download attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
      }

      // Wait 2 seconds before next attempt (except on last attempt)
      if (attempt < maxAttempts) {
        await delay(2000);
      }
    }

    throw new Error(`Data export did not complete within ${maxAttempts} attempts (${maxAttempts * 2} seconds)`);
  }

  /**
   * Download data export for a given query ID (generic version)
   */
  async downloadDataExport(queryId: string, format: 'csv' | 'json' = 'json'): Promise<string> {
    const response = await this.makeRequest(`/v2/query/${queryId}/download`);
    
    if (format === 'json') {
      const data = await response.json();
      return JSON.stringify(data, null, 2);
    } else {
      return await response.text();
    }
  }

  /**
   * Export data from Sigma (complete workflow - export then download)
   */
  async exportData(workbookId: string, elementId: string, format: 'csv' | 'json' = 'json', parameters?: { [key: string]: string }): Promise<string> {
    console.log(`Initiating data export for workbook ${workbookId}, element ${elementId}, format ${format}`);
    if (parameters) {
      console.log(`Using parameters:`, parameters);
    }
    
    const queryId = await this.initiateDataExport(workbookId, elementId, format, parameters);
    console.log(`Data export initiated with query ID: ${queryId}`);
    
    return await this.pollForDataExportCompletion(queryId, format);
  }

  /**
   * Initiate a document analytics export (specific for analytics)
   */
  async initiateDocumentExport(workbookId: string, elementId: string, parameters?: { [key: string]: string }): Promise<string> {
    console.log(`🔍 [DEBUG] initiateDocumentExport called with workbookId: ${workbookId}, elementId: ${elementId}`);
    if (parameters) {
      console.log(`🔍 [DEBUG] Using parameters:`, parameters);
    }
    
    const exportRequest: ExportRequest = {
      format: {
        type: 'jsonl'
      },
      elementId
    };

    // Add parameters if provided
    if (parameters) {
      exportRequest.parameters = parameters;
    }

    console.log(`🔍 [DEBUG] Export request payload:`, JSON.stringify(exportRequest, null, 2));
    console.log(`🔍 [DEBUG] Making POST request to /v2/workbooks/${workbookId}/export`);

    try {
      const response = await this.makeRequest(`/v2/workbooks/${workbookId}/export`, {
        method: 'POST',
        body: JSON.stringify(exportRequest),
      });

      console.log(`✅ [DEBUG] Export request successful, status: ${response.status}`);
      const data: ExportResponse = await response.json();
      console.log(`✅ [DEBUG] Export response:`, JSON.stringify(data, null, 2));
      
      return data.queryId;
    } catch (error) {
      console.log(`❌ [DEBUG] initiateDocumentExport failed:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Poll for export completion and download analytics data
   */
  async pollForExportCompletion(queryId: string, maxAttempts: number = 30): Promise<DocumentAnalytics[]> {
    console.log(`🔍 [DEBUG] pollForExportCompletion called with queryId: ${queryId}, maxAttempts: ${maxAttempts}`);
    
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`🔍 [DEBUG] Polling for export completion, attempt ${attempt}/${maxAttempts}`);
        
        const data = await this.downloadExportData(queryId);
        if (data && data.length > 0) {
          console.log(`✅ [DEBUG] Export completed successfully after ${attempt} attempts`);
          return data;
        } else {
          console.log(`🔍 [DEBUG] Export not ready yet (attempt ${attempt}), data length: ${data?.length || 0}`);
        }
      } catch (error) {
        console.log(`⚠️ [DEBUG] Download attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
      }

      // Wait 2 seconds before next attempt (except on last attempt)
      if (attempt < maxAttempts) {
        console.log(`🔍 [DEBUG] Waiting 2 seconds before next attempt...`);
        await delay(2000);
      }
    }

    console.log(`❌ [DEBUG] Export did not complete within ${maxAttempts} attempts`);
    throw new Error(`Export did not complete within ${maxAttempts} attempts (${maxAttempts * 2} seconds)`);
  }

  /**
   * Download export data for a given query ID (analytics specific)
   */
  async downloadExportData(queryId: string): Promise<DocumentAnalytics[]> {
    console.log(`🔍 [DEBUG] downloadExportData called with queryId: ${queryId}`);
    
    try {
      console.log(`🔍 [DEBUG] Making GET request to /v2/query/${queryId}/download`);
      const response = await this.makeRequest(`/v2/query/${queryId}/download`);
      console.log(`✅ [DEBUG] Download request successful, status: ${response.status}`);
      
      const text = await response.text();
      console.log(`🔍 [DEBUG] Downloaded text length: ${text.length} characters`);
      
      if (!text.trim()) {
        console.log(`🔍 [DEBUG] No data available yet (empty response)`);
        return [];
      }

      // Parse JSONL format (one JSON object per line)
      const lines = text.trim().split('\n');
      console.log(`🔍 [DEBUG] Parsing ${lines.length} lines of JSONL data`);
      
      const analytics: DocumentAnalytics[] = [];

      for (const line of lines) {
        if (line.trim()) {
          try {
            const rawData = JSON.parse(line);
            analytics.push(this.parseDocumentAnalytics(rawData));
          } catch (error) {
            console.error('❌ [DEBUG] Failed to parse JSONL line:', line, error);
          }
        }
      }

      console.log(`✅ [DEBUG] Successfully parsed ${analytics.length} analytics records`);
      return analytics;
    } catch (error) {
      console.log(`❌ [DEBUG] downloadExportData failed:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Parse raw document analytics data into structured format
   */
  private parseDocumentAnalytics(rawData: any): DocumentAnalytics {
    return {
      interactions: rawData['# Interactions'] || 0,
      interactionsPercentile: rawData['# Interactions (Percentile)'] || 0,
      opens: rawData['# Opens'] || 0,
      opensPercentile: rawData['# Opens (Percentile)'] || 0,
      publishes: rawData['# Publishes'] || 0,
      publishesPercentile: rawData['# Publishes (Percentile)'] || 0,
      users: rawData['# Users'] || 0,
      accountType: rawData['Account Type (Doc Created by)'] || '',
      daysSinceLastActivity: rawData['Days Since Last Activity'] || 0,
      daysWithActivity: rawData['Days w/ Activity'] || 0,
      daysWithActivityPercentile: rawData['Days w/ Activity (Percentile)'] || 0,
      details: rawData['Details'] || '',
      docCreatedAt: rawData['Doc Created At (UTC)'] || '',
      docCreatedByEmail: rawData['Doc Created By (email)'] || '',
      docCreatedByName: rawData['Doc Created By (name)'] || '',
      documentName: rawData['Document Name [version]'] || '',
      documentType: rawData['Document Type'] || '',
      firstActivity: rawData['First Activity (UTC)'] || '',
      lastActivity: rawData['Last Activity (UTC)'] || '',
      lastOpenedOn: rawData['Last Opened On (UTC)'] || '',
      lastInteractedOn: rawData['Last Interacted On (UTC)'] || undefined,
      lastPublishedOn: rawData['Last Published On (UTC)'] || undefined,
      versionTag: rawData['Version Tag'] || '',
    };
  }

  // Heartbeat method to test API connectivity
  async whoami(): Promise<any> {
    try {
      const response = await this.makeRequest('/v2/whoami');
      return await response.json();
    } catch (error) {
      // If whoami endpoint doesn't exist, try a different approach
      console.log('Whoami endpoint failed, trying alternative authentication test...');
      
      // Try to list workbooks as an alternative authentication test
      try {
        const response = await this.makeRequest('/v2/workbooks?limit=1');
        const data = await response.json();
        return {
          authenticated: true,
          message: 'Authentication successful (tested via workbooks endpoint)',
          workbooks_count: data.entries?.length || 0
        };
      } catch (workbookError) {
        throw new Error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Placeholder method - implement based on Sigma's actual search API
  async searchDocuments(query: string): Promise<SigmaDocument[]> {
    // This would use Sigma's search API when available
    // For now, we'll rely on the cached search functionality
    throw new Error("Direct API search not implemented - use cached search instead");
  }

  /**
   * Get document analytics data (complete workflow)
   */
  async getDocumentAnalytics(workbookId: string, elementId: string, parameters?: { [key: string]: string }): Promise<DocumentAnalytics[]> {
    console.log(`🔍 [DEBUG] getDocumentAnalytics called with workbookId: ${workbookId}, elementId: ${elementId}`);
    if (parameters) {
      console.log(`🔍 [DEBUG] Using parameters:`, parameters);
    }
    
    try {
      console.log(`🔍 [DEBUG] Initiating document analytics export for workbook ${workbookId}, element ${elementId}`);
      const queryId = await this.initiateDocumentExport(workbookId, elementId, parameters);
      console.log(`✅ [DEBUG] Export initiated with query ID: ${queryId}`);
      
      console.log(`🔍 [DEBUG] Polling for export completion...`);
      const analyticsData = await this.pollForExportCompletion(queryId);
      console.log(`✅ [DEBUG] Export completed successfully, retrieved ${analyticsData.length} analytics records`);
      
      return analyticsData;
    } catch (error) {
      console.log(`❌ [DEBUG] getDocumentAnalytics failed:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}