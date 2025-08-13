import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SigmaDocument, DocumentAnalytics } from "./sigma_client";

export interface CachedDocument extends SigmaDocument {
  searchableText: string; // Combined title, description, and other searchable content
  lastCached: string;
}

export interface CachedDocumentAnalytics {
  data: DocumentAnalytics[];
  lastCached: string;
  workbookId: string;
  elementId: string;
}

export class DocumentCache {
  private dynamoClient?: DynamoDBClient;
  private tableName: string;
  private cache: Map<string, CachedDocument[]> = new Map();
  private skipCache: boolean;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.skipCache = process.env.SKIP_CACHE === 'true';
    
    if (this.skipCache) {
      console.log('⚠️ Cache is disabled for testing');
    } else {
      // Use DynamoDB for production
      this.dynamoClient = new DynamoDBClient({});
      console.log(`Using DynamoDB cache table: ${this.tableName}`);
    }
  }

  async initialize() {
    if (this.skipCache) {
      console.log('Skipping cache initialization');
      this.cache.set('workbooks', []);
      this.cache.set('datasets', []);
      return;
    }
    
    // Load cached documents into memory for faster searches
    await this.loadCacheFromDynamoDB();
  }

  private async loadCacheFromDynamoDB() {
    try {
      const workbooks = await this.getCachedDocuments('workbook');
      const datasets = await this.getCachedDocuments('dataset');
      
      this.cache.set('workbooks', workbooks);
      this.cache.set('datasets', datasets);
      
      console.log(`Loaded ${workbooks.length} workbooks and ${datasets.length} datasets from cache`);
    } catch (error) {
      console.error("Failed to load cache from DynamoDB:", error);
      // Initialize empty cache
      this.cache.set('workbooks', []);
      this.cache.set('datasets', []);
    }
  }

  private async getCachedDocuments(documentType: 'workbook' | 'dataset'): Promise<CachedDocument[]> {
    if (!this.dynamoClient) {
      throw new Error("DynamoDB client not initialized");
    }

    const params = {
      TableName: this.tableName,
      FilterExpression: "#type = :type",
      ExpressionAttributeNames: {
        "#type": "type"
      },
      ExpressionAttributeValues: marshall({
        ":type": documentType
      }, { removeUndefinedValues: true })
    };

    const result = await this.dynamoClient.send(new ScanCommand(params));
    
    return result.Items?.map(item => unmarshall(item) as CachedDocument) || [];
  }

  async getWorkbooks(): Promise<CachedDocument[]> {
    return this.cache.get('workbooks') || [];
  }

  async getDatasets(): Promise<CachedDocument[]> {
    return this.cache.get('datasets') || [];
  }

  async searchDocuments(query: string, documentType: 'workbook' | 'dataset' | 'all' = 'all', limit: number = 10): Promise<CachedDocument[]> {
    const searchTerm = query.toLowerCase();
    let documentsToSearch: CachedDocument[] = [];

    if (documentType === 'all') {
      documentsToSearch = [
        ...(this.cache.get('workbooks') || []),
        ...(this.cache.get('datasets') || [])
      ];
    } else if (documentType === 'workbook') {
      documentsToSearch = this.cache.get('workbooks') || [];
    } else if (documentType === 'dataset') {
      documentsToSearch = this.cache.get('datasets') || [];
    }

    // Simple text-based search with relevance scoring
    const results = documentsToSearch
      .map(doc => ({
        document: doc,
        score: this.calculateRelevanceScore(doc, searchTerm)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.document);

    return results;
  }

  private calculateRelevanceScore(document: CachedDocument, searchTerm: string): number {
    let score = 0;
    const searchableText = document.searchableText.toLowerCase();
    const name = document.name.toLowerCase();
    const description = (document.description || '').toLowerCase();

    // Exact name match gets highest score
    if (name === searchTerm) {
      score += 100;
    }
    // Name contains search term
    else if (name.includes(searchTerm)) {
      score += 50;
    }

    // Description contains search term
    if (description.includes(searchTerm)) {
      score += 25;
    }

    // General searchable text contains search term
    if (searchableText.includes(searchTerm)) {
      score += 10;
    }

    // Bonus for multiple word matches
    const searchWords = searchTerm.split(' ').filter(word => word.length > 2);
    for (const word of searchWords) {
      if (searchableText.includes(word)) {
        score += 5;
      }
    }

    return score;
  }

  // Method to update cache - would be called by a separate caching process
  async updateDocumentCache(documents: SigmaDocument[], documentType: 'workbook' | 'dataset') {
    const cachedDocuments: CachedDocument[] = documents.map(doc => ({
      ...doc,
      searchableText: this.buildSearchableText(doc),
      lastCached: new Date().toISOString()
    }));

    if (this.skipCache) {
      console.log('Cache disabled, skipping document cache update');
      return;
    }

    // Store in DynamoDB
    if (!this.dynamoClient) {
      throw new Error("DynamoDB client not initialized");
    }

    for (const doc of cachedDocuments) {
      await this.dynamoClient.send(new PutItemCommand({
        TableName: this.tableName,
        Item: marshall({
          ...doc
        })
      }));
    }

    // Update in-memory cache
    this.cache.set(documentType === 'workbook' ? 'workbooks' : 'datasets', cachedDocuments);
    
    console.log(`Updated cache with ${cachedDocuments.length} ${documentType}s`);
  }

  private buildSearchableText(document: SigmaDocument): string {
    const parts = [
      document.name,
      document.description || '',
      ...(document.tags || []),
      ...(document.elements?.map(el => `${el.name} ${el.description || ''}`) || [])
    ];

    return parts.join(' ').toLowerCase();
  }

  // Utility method to refresh cache from Sigma API
  async refreshCache(sigmaClient: any) {
    try {
      console.log("Refreshing document cache...");
      
      const [workbooks, datasets] = await Promise.all([
        sigmaClient.listWorkbooks(),
        sigmaClient.listDatasets()
      ]);
      
      await Promise.all([
        this.updateDocumentCache(workbooks, 'workbook'),
        this.updateDocumentCache(datasets, 'dataset')
      ]);
      
      console.log(`Cache refreshed: ${workbooks.length} workbooks, ${datasets.length} datasets`);
    } catch (error) {
      console.error("Failed to refresh cache:", error);
      throw error;
    }
  }

  /**
   * Get cached document analytics data
   */
  async getCachedDocumentAnalytics(workbookId: string, elementId: string): Promise<DocumentAnalytics[] | null> {
    if (this.skipCache) {
      console.log('Cache disabled, returning null for analytics data');
      return null;
    }
    
    const cacheKey = `analytics:${workbookId}:${elementId}`;
    return this.getCachedAnalyticsFromDynamoDB(cacheKey);
  }

  /**
   * Cache document analytics data
   */
  async cacheDocumentAnalytics(workbookId: string, elementId: string, data: DocumentAnalytics[]): Promise<void> {
    if (this.skipCache) {
      console.log('Cache disabled, skipping analytics data caching');
      return;
    }
    
    const cacheKey = `analytics:${workbookId}:${elementId}`;
    const cachedData: CachedDocumentAnalytics = {
      data,
      lastCached: new Date().toISOString(),
      workbookId,
      elementId
    };

    await this.saveAnalyticsToDynamoDB(cacheKey, cachedData);
  }

  /**
   * Check if analytics data is still valid (within 30 minutes)
   */
  isAnalyticsCacheValid(lastCached: string): boolean {
    const cacheAge = Date.now() - new Date(lastCached).getTime();
    const thirtyMinutes = 30 * 60 * 1000; // 30 minutes in milliseconds
    return cacheAge < thirtyMinutes;
  }

  private async getCachedAnalyticsFromDynamoDB(cacheKey: string): Promise<DocumentAnalytics[] | null> {
    if (!this.dynamoClient) {
      throw new Error("DynamoDB client not initialized");
    }

    try {
      const command = new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          pk: cacheKey,
          sk: 'analytics'
        }, { removeUndefinedValues: true })
      });

      const response = await this.dynamoClient.send(command);
      
      if (!response.Item) {
        return null;
      }

      const cachedAnalytics = unmarshall(response.Item) as CachedDocumentAnalytics;
      
      // Check if cache is still valid
      if (!this.isAnalyticsCacheValid(cachedAnalytics.lastCached)) {
        console.log(`Analytics cache expired for ${cacheKey}`);
        return null;
      }

      return cachedAnalytics.data;
    } catch (error) {
      console.error("Failed to load analytics from DynamoDB:", error);
      return null;
    }
  }

  private async saveAnalyticsToDynamoDB(cacheKey: string, data: CachedDocumentAnalytics): Promise<void> {
    if (!this.dynamoClient) {
      throw new Error("DynamoDB client not initialized");
    }

    try {
      const command = new PutItemCommand({
        TableName: this.tableName,
        Item: marshall({
          pk: cacheKey,
          sk: 'analytics',
          ...data
        }, { removeUndefinedValues: true })
      });

      await this.dynamoClient.send(command);
      console.log(`Analytics cache saved to DynamoDB: ${cacheKey}`);
    } catch (error) {
      console.error("Failed to save analytics to DynamoDB:", error);
      throw error;
    }
  }
}