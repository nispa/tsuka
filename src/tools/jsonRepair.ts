/**
 * Motore di riparazione e sanificazione JSON per Tool Calls (T11.8).
 * Gestisce i glitch tipici dei modelli LLM locali (es. Qwen, Llama):
 *  - blocchi markdown code fences (```json ... ```);
 *  - newline letterali o caratteri di controllo non escapati dentro stringhe di codice;
 *  - stringhe o oggetti troncati per limite token (mancanza di quote e graffe di chiusura);
 *  - trailing comma in array e oggetti;
 *  - caratteri spuri all'inizio o alla fine del JSON.
 */

export interface JsonRepairResult {
  parsed: any;
  repairedJson: string;
  isRepaired: boolean;
  isMalformed: boolean;
}

/**
 * Tenta di riparare una stringa JSON non valida applicando progressive strategie di correzione.
 */
export function repairJsonString(raw: string): { repaired: string; parsed: any } | null {
  let text = raw.trim();

  // Strategia 0: Parse diretto
  try {
    const parsed = JSON.parse(text);
    return { repaired: text, parsed };
  } catch {}

  // Strategia 1: Rimozione markdown codeblocks (es. ```json ... ```)
  const codeBlockMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
    try {
      const parsed = JSON.parse(text);
      return { repaired: text, parsed };
    } catch {}
  }

  // Strategia 2: Estrazione del primo blocco JSON delimitato da { ... } o [ ... ]
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

  // Strategia 3: Risoluzione di newline letterali non escapati dentro stringhe JSON
  // (caso frequente quando un modello passa codice multiriga dentro un parametro stringa)
  try {
    const sanitizedNewlines = fixUnescapedNewlinesInStrings(text);
    const parsed = JSON.parse(sanitizedNewlines);
    return { repaired: sanitizedNewlines, parsed };
  } catch {}

  // Strategia 4: Rimozione di trailing commas (es. {"a": 1, })
  try {
    const noTrailingCommas = text.replace(/,\s*([}\]])/g, '$1');
    const parsed = JSON.parse(noTrailingCommas);
    return { repaired: noTrailingCommas, parsed };
  } catch {}

  // Strategia 5: Chiusura di stringhe o oggetti troncati a metà
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
 * Normalizza newline letterali non escapati all'interno di stringhe JSON.
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
 * Sanifica e ripara gli argomenti di una tool call.
 * Garantisce che il JSON restituito sia SEMPRE valido al 100%,
 * proteggendo i backend LLM locali (llama-server, Ollama) da crash HTTP 500 su chiamate successive.
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

  // 1. Tenta la riparazione euristica e il parse
  const repairOutcome = repairJsonString(raw);
  if (repairOutcome) {
    return {
      parsed: repairOutcome.parsed,
      repairedJson: repairOutcome.repaired,
      isRepaired: repairOutcome.repaired !== raw,
      isMalformed: false
    };
  }

  // 2. Fallback estremo anti-500: incapsulamento sicuro
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
