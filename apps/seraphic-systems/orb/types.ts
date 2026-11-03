// Compile-time shapes for the active Horizon contract. Runtime front matter is
// still validated against schema/records.json before it can be published.
export interface HorizonData {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4;
  description: string;
  created_at?: string | null;
  visibility?: 'public' | 'private';
}

export interface HorizonRecord {
  key?: string;
  type: 'Horizon';
  data: HorizonData;
  content?: string;
  contentHtml?: string;
}

export interface Catalog { records: HorizonRecord[] }

export interface HorizonNode {
  id: string;
  label: string;
  level: HorizonData['level'];
  description: string;
  createdAt?: string | null;
  content?: string;
  contentHtml?: string;
}

export interface ContentSource {
  id: string;
  label: string;
  views: { default: string; options: { id: string; presentation: string; arrangement: string; controls: Record<string, never> }[] };
  children: HorizonNode[];
}
