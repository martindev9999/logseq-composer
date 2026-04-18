import { EditAction, EditCommand, ParseResult } from './types/editTypes';

const VALID_ACTIONS: ReadonlySet<string> = new Set(['insert', 'update', 'delete']);

/**
 * Regex to match ```json-edit ... ``` fenced code blocks.
 * Captures the content between the fences.
 */
const JSON_EDIT_BLOCK_RE = /```json-edit\s*\n([\s\S]*?)```/g;

/**
 * Validate a single command object against the EditCommand schema.
 * Returns null if invalid, the validated command if valid.
 */
export function validateEditCommand(obj: unknown): EditCommand | null {
  if (obj == null || typeof obj !== 'object') {
    console.warn('[editCommandParser] Command is not an object:', obj);
    return null;
  }

  const raw = obj as Record<string, unknown>;

  if (typeof raw.action !== 'string' || !VALID_ACTIONS.has(raw.action)) {
    console.warn('[editCommandParser] Invalid or missing action:', raw.action);
    return null;
  }

  const action = raw.action as EditAction;

  if (action === 'insert') {
    if (typeof raw.parentBlockUUID !== 'string' || typeof raw.content !== 'string') {
      console.warn('[editCommandParser] insert requires parentBlockUUID and content:', raw);
      return null;
    }
  } else if (action === 'update') {
    if (typeof raw.blockUUID !== 'string' || typeof raw.content !== 'string') {
      console.warn('[editCommandParser] update requires blockUUID and content:', raw);
      return null;
    }
  } else if (action === 'delete') {
    if (typeof raw.blockUUID !== 'string') {
      console.warn('[editCommandParser] delete requires blockUUID:', raw);
      return null;
    }
  }

  const cmd: EditCommand = { action };

  if (typeof raw.blockUUID === 'string') cmd.blockUUID = raw.blockUUID;
  if (typeof raw.parentBlockUUID === 'string') cmd.parentBlockUUID = raw.parentBlockUUID;
  if (typeof raw.content === 'string') cmd.content = raw.content;
  if (typeof raw.siblingOrder === 'number') cmd.siblingOrder = raw.siblingOrder;

  return cmd;
}


/**
 * Extract and validate edit commands from raw LLM response text.
 * Looks for ```json-edit fenced code blocks, parses JSON, validates schema.
 * Invalid commands are excluded and logged.
 */
export function parseEditCommands(rawResponse: string): ParseResult {
  const commands: EditCommand[] = [];

  // Reset lastIndex before each use of the global regex
  JSON_EDIT_BLOCK_RE.lastIndex = 0;
  const textWithoutEditBlocks = rawResponse.replace(JSON_EDIT_BLOCK_RE, '').trim();

  let match: RegExpExecArray | null;
  JSON_EDIT_BLOCK_RE.lastIndex = 0;

  while ((match = JSON_EDIT_BLOCK_RE.exec(rawResponse)) !== null) {
    const jsonContent = match[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonContent);
    } catch (e) {
      console.warn('[editCommandParser] Malformed JSON in json-edit block:', e);
      continue;
    }

    if (!Array.isArray(parsed)) {
      console.warn('[editCommandParser] json-edit block content is not an array');
      continue;
    }

    for (const item of parsed) {
      const validated = validateEditCommand(item);
      if (validated) {
        commands.push(validated);
      }
    }
  }

  return { commands, textWithoutEditBlocks };
}

/**
 * Serialize an array of EditCommands to a json-edit fenced code block string.
 */
export function serializeEditCommands(commands: EditCommand[]): string {
  return '```json-edit\n' + JSON.stringify(commands, null, 2) + '\n```';
}
