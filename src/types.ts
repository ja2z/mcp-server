// Updated interfaces to match your desired schema

export interface SigmaDocument {
    id: string;
    type: 'workbook' | 'dataset';
    name: string;
    description?: string;
    url: string;
    created_by: string; // email
    updated_at: string; // ISO date string
    badge_status: 'Endorsed' | 'Warning' | 'Deprecated';
    // Keep these for API compatibility but they won't be stored in cache
    createdAt?: string;
    updatedAt?: string;  
    tags?: string[];
    elements?: SigmaElement[];
  }
  
  export interface CachedDocument {
    id: string;
    type: 'workbook' | 'dataset';
    name: string;
    description?: string;
    url: string;
    searchable_text: string; // Combined searchable content
    last_cached_at: string; // ISO date string
    created_by: string; // email
    updated_at: string; // ISO date string
    badge_status: 'Endorsed' | 'Warning' | 'Deprecated';
  }
  
  export interface SigmaElement {
    id: string;
    name: string;
    type: string;
    description?: string;
  }