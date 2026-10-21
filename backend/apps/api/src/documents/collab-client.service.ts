import type { DocJSON } from '@luna/editor';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors/app-error.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

const TIMEOUT_MS = 15_000;

@Injectable()
export class CollabClient {
  private readonly logger = new Logger(CollabClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async snapshot(nodeId: string, workspaceId: string, actorId: string): Promise<Uint8Array> {
    return this.call(nodeId, 'snapshot', { workspaceId, actorId });
  }

  async replace(
    nodeId: string,
    workspaceId: string,
    actorId: string,
    json: DocJSON,
  ): Promise<Uint8Array> {
    return this.call(nodeId, 'replace', { workspaceId, actorId, json });
  }

  private async call(
    nodeId: string,
    action: 'snapshot' | 'replace',
    body: object,
  ): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await fetch(
        new URL(`/internal/documents/${nodeId}/${action}`, this.config.COLLAB_INTERNAL_URL),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': this.config.COLLAB_INTERNAL_SECRET,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error({ err, nodeId, action }, 'Collab server unreachable');
      throw AppError.unavailable('The collaboration server is not reachable, try again shortly');
    }
    if (!res.ok) {
      this.logger.error(
        { status: res.status, nodeId, action },
        'Collab server rejected internal call',
      );
      throw AppError.unavailable('The collaboration server could not apply this change');
    }
    const { state } = (await res.json()) as { state: string };
    return new Uint8Array(Buffer.from(state, 'base64'));
  }
}
