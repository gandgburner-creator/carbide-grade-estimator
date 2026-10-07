// Bootstrap for UB-0 worker threads: register tsx's TypeScript loader, then run the worker.
import { register } from 'tsx/esm/api';

register();
await import('./ub0Worker.ts');
