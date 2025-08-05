import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SigmaDocument } from "./sigma_client";

export interface CachedDocument extends SigmaDocument {
  searchableText: string; // Combined title, description, and other searchable content
  lastCached: string;
}

export class DocumentCache {
  private dynamoClient: DynamoDBClient;
  private tableName: string;
  private cache: Map<string, CachedDocument[]> = new Map();

  constructor(tableName: string) {
    this.tableName = tableName;
    this.dynamoClient = new DynamoDBClient({});
  }

  async initialize() {
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

    // Store in DynamoDB
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
}