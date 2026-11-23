export function isAllowedHost(host: string | undefined, port: number): boolean;
export function loopbackOrigins(port: number): Set<string>;
export function proxyCallerAllowed(
  headers: Record<string, string | string[] | undefined>,
  allowedOrigins: Set<string>
): boolean;
export function proxyResponseHeaders(contentType: string): Record<string, string>;
