export interface ProxyResult {
  status: number;
  contentType: string;
  body: string;
  finalUrl?: string;
}

export interface UrlValidation {
  ok: boolean;
  url?: string;
  error?: string;
}

export function validateFeedUrl(raw: string): UrlValidation;
export function proxyFeedRequest(rawTarget: string | null | undefined, timeoutMs?: number): Promise<ProxyResult>;
