/**
 * JSON Repair and Sanitization engine for Tool Calls (T11.8).
 * Handles common glitches from local LLM outputs (e.g. Qwen, Llama):
 *  - markdown code fence blocks (```json ... ```);
 *  - unescaped literal newlines inside multiline code strings;
 *  - truncated strings/objects missing closing quotes and braces;
 *  - trailing commas in objects and arrays;
 *  - extraneous characters before/after the valid JSON token boundaries.
 */

export interface JsonRepairResult {
  parsed: any;
  repairedJson: string;
  isRepaired: boolean;
  isMalformed: boolean;
}

/**
 * Attempts to repair invalid JSON strings using layered heuristic strategies.
 */
export function repairJsonString(raw: string): { repaired: string; parsed: any } | null {
  let text = raw.trim();

  // Strategy 0: Direct parse
  try {
    const parsed = JSON.parse(text);
    return { repaired: text, parsed };
  } catch {}

  // Strategy 1: Markdown code block extraction
  const codeBlockMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
    try {
      const parsed = JSON.parse(text);
      return { repaired: text, parsed };
    } catch {}
  }

  // Strategy 2: Extract first JSON block bounded by { ... } or [ ... ]
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let startIndex = -1;

  if (firstBrace !== -1 && firstBracket !== -1) {
    startIndex = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIndex = firstBrace;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
  }

  if (startIndex > 0) {
    text = text.slice(startIndex).trim();
    try {
      const parsed = JSON.parse(text);
      return { repaired: text, parsed };
    } catch {}
  }

  // Strategy 3: Fix unescaped newlines inside JSON string parameters
  try {
    const sanitizedNewlines = fixUnescapedNewlinesInStrings(text);
    const parsed = JSON.parse(sanitizedNewlines);
    return { repaired: sanitizedNewlines, parsed };
  } catch {}

  // Strategy 4: Remove trailing commas
  try {
    const noTrailingCommas = text.replace(/,\s*([}\]])/g, '$1');
    const parsed = JSON.parse(noTrailingCommas);
    return { repaired: noTrailingCommas, parsed };
  } catch {}

  // Strategy 5: Close truncated string or object boundaries
  const candidates: string[] = [
    text + '"\n}',
    text + '"}',
    text + '"]}',
    text + '"} }',
    text + '}',
    text + ']',
    text + '"',
  ];

  for (const candidate of candidates) {
    try {
      const fixedNewlines = fixUnescapedNewlinesInStrings(candidate);
      const parsed = JSON.parse(fixedNewlines);
      if (parsed && typeof parsed === 'object') {
        return { repaired: fixedNewlines, parsed };
      }
    } catch {}

    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return { repaired: candidate, parsed };
      }
    } catch {}
  }

  return null;
}

/**
 * Normalizes unescaped newlines inside JSON string literals.
 */
function fixUnescapedNewlinesInStrings(jsonStr: string): string {
  let inString = false;
  let isEscaped = false;
  let result = '';

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (char === '"' && !isEscaped) {
      inString = !inString;
      result += char;
    } else if (inString && char === '\n') {
      result += '\\n';
    } else if (inString && char === '\r') {
      result += '\\r';
    } else if (inString && char === '\t') {
      result += '\\t';
    } else {
      result += char;
    }

    if (char === '\\' && !isEscaped) {
      isEscaped = true;
    } else {
      isEscaped = false;
    }
  }

  return result;
}

/**
 * Sanitizes and repairs tool call arguments to guarantee valid JSON execution.
 */
export function sanitizeToolCallArguments(rawArguments: string | undefined): JsonRepairResult {
  const raw = (rawArguments || '').trim();
  if (!raw) {
    return {
      parsed: {},
      repairedJson: '{}',
      isRepaired: false,
      isMalformed: false
    };
  }

  const repairOutcome = repairJsonString(raw);
  if (repairOutcome) {
    return {
      parsed: repairOutcome.parsed,
      repairedJson: repairOutcome.repaired,
      isRepaired: repairOutcome.repaired !== raw,
      isMalformed: false
    };
  }

  const fallback = {
    _error: 'invalid_json_arguments',
    _raw_malformed_input: raw
  };
  return {
    parsed: fallback,
    repairedJson: JSON.stringify(fallback),
    isRepaired: true,
    isMalformed: true
  };
}
