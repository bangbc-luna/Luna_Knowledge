import { loadCollabConfig } from './config.js';
import { createCollabServer } from './server.js';

const server = createCollabServer(loadCollabConfig());
await server.listen();
