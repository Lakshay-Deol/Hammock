import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities.js';
import { HAMMOCK_TASK_QUEUE } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WorkerOptions {
  address?: string;
  namespace?: string;
  taskQueue?: string;
}

export async function createHammockWorker(options?: WorkerOptions): Promise<Worker> {
  const address = options?.address ?? process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
  const namespace = options?.namespace ?? process.env['TEMPORAL_NAMESPACE'] ?? 'default';
  const taskQueue = options?.taskQueue ?? HAMMOCK_TASK_QUEUE;

  const connection = await NativeConnection.connect({ address });

  // Resolve workflows path
  const workflowsPath = path.resolve(__dirname, 'workflows.js');

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities,
  });

  return worker;
}

export async function runWorker(options?: WorkerOptions): Promise<void> {
  const worker = await createHammockWorker(options);
  console.log(`👷 Hammock Temporal worker started on task queue "${HAMMOCK_TASK_QUEUE}"`);
  console.log('Press Ctrl+C to stop.');
  await worker.run();
}
