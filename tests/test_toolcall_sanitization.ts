import assert from 'node:assert/strict';
import { sanitizeAndParseToolArgs, Agent } from '../src/core/agent';
import { MockLLMProvider } from './mocks/mockProvider';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';

export async function runToolCallSanitizationTests(): Promise<void> {
  // Test 1: JSON valido
  {
    const valid = '{"path":"src/index.ts","content":"console.log(1);"}';
    const result = sanitizeAndParseToolArgs(valid);
    assert.equal(result.isMalformed, false);
    assert.deepEqual(result.parsedArgs, { path: 'src/index.ts', content: 'console.log(1);' });
    assert.equal(result.sanitizedJsonString, valid);
  }

  // Test 2: JSON con chiusura mancante (auto-riparazione)
  {
    const truncated = '{"path":"src/test.ts","content":"hello world';
    const result = sanitizeAndParseToolArgs(truncated);
    assert.equal(result.isMalformed, false);
    assert.equal(result.parsedArgs.path, 'src/test.ts');
    assert.equal(result.parsedArgs.content, 'hello world');
    assert.doesNotThrow(() => JSON.parse(result.sanitizedJsonString));
  }

  // Test 3: Markdown codeblock wrapper (```json ... ```)
  {
    const markdownWrapped = '```json\n{"path":"config.json","content":"{}"}\n```';
    const result = sanitizeAndParseToolArgs(markdownWrapped);
    assert.equal(result.isMalformed, false);
    assert.equal(result.parsedArgs.path, 'config.json');
    assert.doesNotThrow(() => JSON.parse(result.sanitizedJsonString));
  }

  // Test 4: Trailing commas
  {
    const withTrailingComma = '{"path":"a.txt","content":"ok",}';
    const result = sanitizeAndParseToolArgs(withTrailingComma);
    assert.equal(result.isMalformed, false);
    assert.equal(result.parsedArgs.path, 'a.txt');
    assert.doesNotThrow(() => JSON.parse(result.sanitizedJsonString));
  }

  // Test 5: JSON con newline letterali non escapati
  {
    const unescapedNewlines = '{"path":"script.js","content":"function test() {\n  return 42;\n}"}';
    const result = sanitizeAndParseToolArgs(unescapedNewlines);
    assert.equal(result.isMalformed, false);
    assert.equal(result.parsedArgs.path, 'script.js');
    assert.ok(result.parsedArgs.content.includes('return 42;'));
  }

  // Test 6: JSON completamente malformato (sanificazione preventiva anti-HTTP 500)
  {
    const broken = '{"path": incomplete... syntax error @#$';
    const result = sanitizeAndParseToolArgs(broken);
    assert.equal(result.isMalformed, true);
    assert.equal(result.parsedArgs._error, 'invalid_json_arguments');
    // Il JSON sanificato DEVE essere parsabile da chiunque (incluso llama-server)
    assert.doesNotThrow(() => JSON.parse(result.sanitizedJsonString));
    const reparsed = JSON.parse(result.sanitizedJsonString);
    assert.equal(reparsed._error, 'invalid_json_arguments');
  }

  // Test 4: Ciclo Agent con tool call malformata (non corrompe messages)
  {
    const mock = new MockLLMProvider([
      {
        content: '',
        toolCalls: [
          {
            id: 'call_broken_1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"broken.txt","content":missing_quotes_and_brackets'
            }
          }
        ]
      },
      {
        content: 'Ho notato l\'errore e mi sono corretto.',
        toolCalls: []
      }
    ]);
    const registry = new ToolRegistry();
    const pm = new PermissionManager();
    const agent = new Agent(mock as any, registry, pm);

    await agent.run('scrivi broken.txt');

    const history = agent.getMessages();
    const assistantMsg = history.find(m => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0);
    assert.ok(assistantMsg, 'Deve esistere il messaggio assistant con tool_calls');
    
    // TUTTI gli arguments nei tool_calls della cronologia DEVONO essere JSON validi
    for (const tc of assistantMsg.tool_calls!) {
      assert.doesNotThrow(
        () => JSON.parse(tc.function.arguments),
        'Gli argomenti salvati nella history devono essere un JSON valido per prevenire HTTP 500'
      );
    }
  }
}

if (process.argv[1]?.endsWith('test_toolcall_sanitization.ts')) {
  runToolCallSanitizationTests().then(() => {
    console.log('4 passati');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
