export interface StreamEvent {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'result' | 'system';
  subtype?: string;
  content?: string;
  sessionId?: string;
  costUsd?: number;
}

export function parseStreamLine(line: string): StreamEvent | null {
  if (!line.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = parsed.type as StreamEvent['type'];
  if (!type) return null;

  const event: StreamEvent = { type };

  if (parsed.subtype) {
    event.subtype = parsed.subtype as string;
  }

  // assistant text content
  if (type === 'assistant' && parsed.content_block_delta) {
    const delta = parsed.content_block_delta as Record<string, unknown>;
    event.content = delta.text as string;
  }

  // result event
  if (type === 'result') {
    if (parsed.session_id) event.sessionId = parsed.session_id as string;
    if (parsed.cost_usd !== undefined) event.costUsd = parsed.cost_usd as number;
  }

  return event;
}
