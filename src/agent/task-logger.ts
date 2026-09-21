import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface TaskLogEvent {
  readonly timestamp: string;
  readonly taskId: string;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface TaskLogger {
  log(event: TaskLogEvent): Promise<void>;
}

export class NullTaskLogger implements TaskLogger {
  public log(): Promise<void> {
    return Promise.resolve();
  }
}

export class JsonlTaskLogger implements TaskLogger {
  public constructor(private readonly directory: string) {}

  public async log(event: TaskLogEvent): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(
      join(this.directory, `${event.taskId}.jsonl`),
      `${JSON.stringify(event)}\n`,
      'utf8',
    );
  }
}
