import type { Router } from 'express';
import type http from 'http';

export interface SliceServer {
  router: Router;
  /** optional async setup; a rejection disables this slice, not the server */
  init?: () => Promise<void>;
  /** optional access to the raw http.Server, for WebSocket upgrades */
  attach?: (server: http.Server) => void;
}
