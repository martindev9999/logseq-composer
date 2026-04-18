export type EditAction = 'insert' | 'update' | 'delete';

export interface EditCommand {
  action: EditAction;
  blockUUID?: string;       // required for update, delete
  parentBlockUUID?: string; // required for insert
  content?: string;         // required for insert, update
  siblingOrder?: number;    // optional hint for insert position
}

export interface ParseResult {
  commands: EditCommand[];
  textWithoutEditBlocks: string; // LLM response with json-edit blocks stripped
}

export type OperationOutcome = {
  command: EditCommand;
  status: 'success' | 'error' | 'denied';
  error?: string;
};

export interface ExecutionResult {
  successCount: number;
  failedCount: number;
  deniedCount: number;
  outcomes: OperationOutcome[];
}
