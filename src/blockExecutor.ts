import type { EditCommand, ExecutionResult, OperationOutcome } from './types/editTypes';

/**
 * Execute a single EditCommand against the Logseq Editor API.
 * Used by PermissionPrompt "Allow" action.
 */
export async function executeOne(command: EditCommand): Promise<OperationOutcome> {
  try {
    switch (command.action) {
      case 'insert': {
        if (!command.parentBlockUUID) {
          return { command, status: 'error', error: 'Missing parentBlockUUID for insert command' };
        }
        await logseq.Editor.insertBlock(command.parentBlockUUID, command.content ?? '', {
          sibling: false,
        });
        return { command, status: 'success' };
      }
      case 'update': {
        if (!command.blockUUID) {
          return { command, status: 'error', error: 'Missing blockUUID for update command' };
        }
        await logseq.Editor.updateBlock(command.blockUUID, command.content ?? '');
        return { command, status: 'success' };
      }
      case 'delete': {
        if (!command.blockUUID) {
          return { command, status: 'error', error: 'Missing blockUUID for delete command' };
        }
        await logseq.Editor.removeBlock(command.blockUUID);
        return { command, status: 'success' };
      }
      default:
        return { command, status: 'error', error: `Unknown action: ${(command as any).action}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`BlockExecutor: failed to execute ${command.action} command:`, message);
    return { command, status: 'error', error: message };
  }
}

/**
 * Execute all commands automatically (autopilot mode).
 * Iterates sequentially, logging errors and continuing on failure.
 */
export async function executeAll(commands: EditCommand[]): Promise<ExecutionResult> {
  const outcomes: OperationOutcome[] = [];

  for (const command of commands) {
    const outcome = await executeOne(command);
    outcomes.push(outcome);
  }

  const successCount = outcomes.filter((o) => o.status === 'success').length;
  const failedCount = outcomes.filter((o) => o.status === 'error').length;
  const deniedCount = outcomes.filter((o) => o.status === 'denied').length;

  return { successCount, failedCount, deniedCount, outcomes };
}
