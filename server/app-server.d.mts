import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { proxyFeedRequest } from './proxy-lib.mjs';

export const DEFAULT_PORT: number;

export function createAppHandler(opts: {
  root: string;
  port: number;
  proxy?: typeof proxyFeedRequest;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function startAppServer(opts: { root: string; port?: number }): Promise<Server[]>;
