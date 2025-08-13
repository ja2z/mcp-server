import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SigmaDocument, CachedDocument } from "./types.js";
import * as fs from 'fs/promises';
import * as path from 'path';


export class DocumentCache {
  private dynamoClient?: DynamoDBClient;
  private tableName: string;
  private cache: Map<string, CachedDocument[]> = new Map();
  private useLocalStorage: boolean;
  private cacheFilePath: string = '';

  constructor(tableName: string) {
    this.tableName = tableName;
    this.useLocalStorage = process.env.USE_LOCAL_CACHE === 'true';
    
    if (this.useLocalStorage) {
      // Use local file storage for testing
      this.cacheFilePath = path.join(process.cwd(), 'local-cache.json');
      console.log(`Using local file cache at: ${this.cacheFilePath}`);
    } else {
      // Use DynamoDB for production
      this.dynamoClient = new DynamoDBClient({region: "us-west-2"});
      console.log(`Using DynamoDB cache table: ${this.tableName}`);
    }
  }

  async initialize() {
    // Load cached documents into memory for faster searches
    if (this.useLocalStorage) {
      await this.loadCacheFromLocalFile();
    } else {
      await this.loadCacheFromDynamoDB();
    }
  }

  private async loadCacheFromLocalFile() {
    try {
      // Check if cache file exists
      try {
        await fs.access(this.cacheFilePath);
      } catch {
        // File doesn't exist, initialize empty cache
        console.log("No local cache file found, initializing empty cache");
        this.cache.set('workbooks', []);
        this.cache.set('datasets', []);
        return;
      }

      const cacheData = await fs.readFile(this.cacheFilePath, 'utf-8');
      const parsedCache = JSON.parse(cacheData);
      
      this.cache.set('workbooks', parsedCache.workbooks || []);
      this.cache.set('datasets', parsedCache.datasets || []);
      
      console.log(`Loaded ${parsedCache.workbooks?.length || 0} workbooks and ${parsedCache.datasets?.length || 0} datasets from local cache`);
    } catch (error) {
      console.error("Failed to load cache from local file:", error);
      // Initialize empty cache
      this.cache.set('workbooks', []);
      this.cache.set('datasets', []);
    }
  }

  private async saveCacheToLocalFile() {
    try {
      const cacheData = {
        workbooks: this.cache.get('workbooks') || [],
        datasets: this.cache.get('datasets') || [],
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
      console.log(`Cache saved to local file: ${this.cacheFilePath}`);
    } catch (error) {
      console.error("Failed to save cache to local file:", error);
    }
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
      })
    };

    const result = await this.dynamoClient.send(new ScanCommand(params));
    console.log(`Found ${result.Items?.length || 0} ${documentType} items in DynamoDB`);

    const documents = result.Items?.map(item => {
      const unmarshalled = unmarshall(item) as CachedDocument;
      // Log first document for debugging
      if (result.Items?.indexOf(item) === 0) {
        console.log(`Sample ${documentType} from DynamoDB:`, JSON.stringify(unmarshalled, null, 2));
      }
      return unmarshalled;
    }) || [];
    
    return documents;
  }

  async getWorkbooks(): Promise<CachedDocument[]> {
    return this.cache.get('workbooks') || [];
  }

  async getDatasets(): Promise<CachedDocument[]> {
    return this.cache.get('datasets') || [];
  }

  async searchDocuments(query: string, documentType: 'workbook' | 'dataset' | 'all' = 'all', limit: number = 10): Promise<CachedDocument[]> {
    console.log(`Searching for: "${query}" in ${documentType} documents, limit: ${limit}`);

    // Add null check for query
    if (!query || typeof query !== 'string') {
      console.error('Invalid query:', query);
      return [];
    }

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

    console.log(`Total documents to search: ${documentsToSearch.length}`);

    // Log the first document structure for debugging
    if (documentsToSearch.length > 0) {
      console.log('Sample document structure:', JSON.stringify(documentsToSearch[0], null, 2));
    }

    // Enhanced search with relevance scoring
    const results = documentsToSearch
    .filter(doc => doc != null)  
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
    // Add debugging
    if (!document) {
      console.error('calculateRelevanceScore: document is undefined');
      return 0;
    }
    
    if (!searchTerm) {
      console.error('calculateRelevanceScore: searchTerm is undefined');
      return 0;
    }

    let score = 0;
    
    // Safely access properties with fallbacks
    const searchableText = (document.searchable_text || '').toLowerCase();
    const name = (document.name || '').toLowerCase();
    const description = (document.description || '').toLowerCase();

    // Debug log if any required field is missing
    if (!document.searchable_text) {
      console.warn(`Document ${document.id} missing searchable_text`);
    }
    if (!document.name) {
      console.warn(`Document ${document.id} missing name`);
    }

    // Rest of your scoring logic...
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

    // Badge status bonus (prioritize endorsed content) - also add null check here
    if (document.badge_status === 'Endorsed') {
      score += 5;
    } else if (document.badge_status === 'Deprecated') {
      score -= 10;
    }

    // Bonus for multiple word matches
    const searchWords = searchTerm.split(' ').filter(word => word.length > 2);
    for (const word of searchWords) {
      if (searchableText.includes(word)) {
        score += 5;
      }
    }

    return Math.max(0, score);
}

  // Convert from Sigma API format to your cache format
  private convertToCache(document: SigmaDocument, sigmaApiData?: any): CachedDocument {
    return {
      id: document.id,
      type: document.type,
      name: document.name,
      description: document.description,
      url: document.url,
      searchable_text: this.buildSearchableText(document),
      last_cached_at: new Date().toISOString(),
      created_by: sigmaApiData?.createdBy || 'unknown@example.com', // You'll need to get this from Sigma API
      updated_at: document.updatedAt || document.createdAt || new Date().toISOString(),
      badge_status: this.determineBadgeStatus(document, sigmaApiData), // You'll need logic for this
    };
  }

  private determineBadgeStatus(document: SigmaDocument, sigmaApiData?: any): 'Endorsed' | 'Warning' | 'Deprecated' {
    // Add your logic here to determine badge status
    // This might come from Sigma API tags, metadata, or custom logic
    if (document.tags?.includes('endorsed')) return 'Endorsed';
    if (document.tags?.includes('deprecated')) return 'Deprecated';
    if (sigmaApiData?.badgeStatus) return sigmaApiData.badgeStatus;
    
    // Default logic - you can customize this
    const daysSinceUpdate = (Date.now() - new Date(document.updatedAt || '').getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > 365) return 'Warning'; // Old content gets warning
    
    return 'Endorsed'; // Default to endorsed
  }

  // Method to update cache - would be called by a separate caching process
  async updateDocumentCache(documents: SigmaDocument[], documentType: 'workbook' | 'dataset', additionalData?: any[]) {
    const cachedDocuments: CachedDocument[] = documents.map((doc, index) => 
      this.convertToCache(doc, additionalData?.[index])
    );

    if (this.useLocalStorage) {
      // Store in local file
      this.cache.set(documentType === 'workbook' ? 'workbooks' : 'datasets', cachedDocuments);
      await this.saveCacheToLocalFile();
    } else {
      // Store in DynamoDB
      if (!this.dynamoClient) {
        throw new Error("DynamoDB client not initialized");
      }

      for (const doc of cachedDocuments) {
        await this.dynamoClient.send(new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(doc)
        }));
      }
    }

    // Update in-memory cache
    this.cache.set(documentType === 'workbook' ? 'workbooks' : 'datasets', cachedDocuments);
    
    console.log(`Updated cache with ${cachedDocuments.length} ${documentType}s`);
  }

  private buildSearchableText(document: SigmaDocument): string {
    const parts = [
      document.name,
      document.description || '',
      document.created_by || '',
      document.badge_status || '',
      ...(document.tags || []),
    ];

    return parts.join(' ').toLowerCase();
  }

  // Utility method to refresh cache from Sigma API
  async refreshCache(sigmaClient: any) {
    console.log("Refreshing document cache...");
    
    try {
      const [workbooks, datasets] = await Promise.all([
        sigmaClient.listWorkbooks(),
        sigmaClient.listDatasets()
      ]);

      // Get detailed information for each workbook (including elements)
      const detailedWorkbooks = await Promise.all(
        workbooks.map((wb: any) => sigmaClient.getWorkbookDetails(wb.id))
      );

      await Promise.all([
        this.updateDocumentCache(detailedWorkbooks, 'workbook'),
        this.updateDocumentCache(datasets, 'dataset')
      ]);

      console.log("Cache refresh completed successfully");
    } catch (error) {
      console.error("Failed to refresh cache:", error);
      throw error;
    }
  }

  // Method to populate cache from a JSON file (for manual loading)
  async loadFromJsonFile(filePath: string) {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const documents = JSON.parse(data) as CachedDocument[];
      
      // Separate workbooks and datasets
      const workbooks = documents.filter(doc => doc.type === 'workbook');
      const datasets = documents.filter(doc => doc.type === 'dataset');

      if (this.useLocalStorage) {
        this.cache.set('workbooks', workbooks);
        this.cache.set('datasets', datasets);
        await this.saveCacheToLocalFile();
      } else {
        // Store in DynamoDB
        if (!this.dynamoClient) {
          throw new Error("DynamoDB client not initialized");
        }

        for (const doc of documents) {
          await this.dynamoClient.send(new PutItemCommand({
            TableName: this.tableName,
            Item: marshall(doc)
          }));
        }

        // Update in-memory cache
        this.cache.set('workbooks', workbooks);
        this.cache.set('datasets', datasets);
      }

      console.log(`Loaded ${workbooks.length} workbooks and ${datasets.length} datasets from JSON file`);
    } catch (error) {
      console.error("Failed to load from JSON file:", error);
      throw error;
    }
  }
}