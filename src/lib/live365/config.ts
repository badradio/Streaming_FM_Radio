import { live365StationId } from './station-id';
import { getPublicStreamUrl, workerEnv } from '../runtime';

export async function getLive365StationId(): Promise<string | undefined> {
  const env = await workerEnv();
  const override =
    (typeof env?.LIVE365_STATION_ID === 'string' ? env.LIVE365_STATION_ID : '') ||
    (globalThis.process?.env?.['LIVE365_STATION_ID'] ?? '');
  const streamUrl = await getPublicStreamUrl();
  return live365StationId({ streamUrl, override });
}
