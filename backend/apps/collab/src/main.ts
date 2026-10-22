import { initSentry } from '@luna/shared';
import { loadCollabConfig } from './config.js';
import { createCollabServer } from './server.js';

const config = loadCollabConfig();
initSentry('collab', config);
const server = createCollabServer(config);
await server.listen();
