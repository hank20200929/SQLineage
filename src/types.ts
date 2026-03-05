export interface Column {
  id: string;
  name: string;
  description?: string;
}

export interface Table {
  id: string;
  name: string;
  type: 'SOURCE' | 'TARGET' | 'INTERMEDIATE';
  columns: Column[];
  description?: string;
  // UI State
  highlightedColumns?: string[];
  dimmed?: boolean;
  onColumnClick?: (tableId: string, columnId: string) => void;
}

export interface LineageEdge {
  id: string;
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnId: string;
  description?: string;
}

export interface LineageData {
  tables: Table[];
  edges: LineageEdge[];
  metadata?: {
    moduleName?: string;
    filters?: string[];
  };
}
