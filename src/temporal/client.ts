import { Connection, Client, ScheduleAlreadyRunning } from '@temporalio/client';
import { nightlyTriageWorkflow, type NightlyTriageWorkflowInput } from './workflows.js';
import { config } from '../config.js';

export const HAMMOCK_TASK_QUEUE = 'hammock-triage-queue';

export interface TemporalConnectionOptions {
  address?: string;
  namespace?: string;
}

export async function getTemporalClient(options?: TemporalConnectionOptions): Promise<Client> {
  const address = options?.address ?? process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
  const namespace = options?.namespace ?? process.env['TEMPORAL_NAMESPACE'] ?? 'default';

  const connection = await Connection.connect({ address });
  return new Client({ connection, namespace });
}

export async function checkTemporalHealth(address = 'localhost:7233'): Promise<{ ok: boolean; message: string }> {
  try {
    const connection = await Connection.connect({ address, connectTimeout: 1500 });
    await connection.workflowService.getSystemInfo({});
    return { ok: true, message: `Temporal server reachable at ${address}` };
  } catch (err) {
    return {
      ok: false,
      message: `Temporal server not reachable at ${address} (Run "temporal server start-dev"): ${String(err)}`,
    };
  }
}

export async function triggerTriageRun(
  input: NightlyTriageWorkflowInput,
  options?: TemporalConnectionOptions
): Promise<{ workflowId: string; runId: string }> {
  const client = await getTemporalClient(options);
  const workflowId = `hammock-run-${input.repo.replace('/', '-')}-${Date.now()}`;

  const handle = await client.workflow.start(nightlyTriageWorkflow, {
    taskQueue: HAMMOCK_TASK_QUEUE,
    args: [input],
    workflowId,
  });

  return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
}

export async function scheduleNightlyTriage(
  repo: string,
  cronExpression = '0 2 * * *',
  options?: TemporalConnectionOptions
): Promise<{ scheduleId: string; message: string }> {
  const client = await getTemporalClient(options);
  const scheduleId = `hammock-nightly-${repo.replace('/', '-')}`;

  try {
    await client.schedule.create({
      scheduleId,
      spec: {
        cronExpressions: [cronExpression],
      },
      action: {
        type: 'startWorkflow',
        workflowType: nightlyTriageWorkflow,
        taskQueue: HAMMOCK_TASK_QUEUE,
        args: [
          {
            repo,
            runId: `scheduled-${Date.now()}`,
          },
        ],
      },
      state: {
        paused: false,
        note: `Hammock durable nightly issue triage for ${repo}`,
      },
    });

    return { scheduleId, message: `Scheduled nightly triage (${cronExpression})` };
  } catch (err) {
    if (err instanceof ScheduleAlreadyRunning) {
      return { scheduleId, message: `Schedule ${scheduleId} is already active.` };
    }
    throw err;
  }
}
