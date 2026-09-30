// Bootstrap for worker threads: register tsx's TypeScript loader, then run the worker.
import { register } from 'tsx/esm/api';

register();
await import('./parallelWorker.ts');
