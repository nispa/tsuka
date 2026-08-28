/** Contract tests for provider failure logging (providers.log). */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let passed = 0;
let failed = 0;
function check(id: string, condition: boolean, detail: string): void {
  if (condition) { passed++; console.log(`PASS ${id} - ${detail}`); }
  else { failed++; console.log(`FAIL ${id} - ${detail}`); }
}

async function main(): Promise<void> {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-provider-logger-'));
  const oldLogsDir = process.env.TSUKA_LOGS_DIR;
  delete process.env.TSUKA_LOGS_DIR;
  process.env.TSUKA_HOME = tempHome;

  try {
    const { maskSensitiveCredentials, logProviderFailure } = await import('../src/core/provider/providerLogger');
    const logFilePath = path.join(tempHome, 'logs', 'providers.log');

    // Test 1: Masking
    const rawUrl = 'https://api.example.com/v1?api_key=sk-abc123456789';
    const rawError = 'Request failed with Bearer my_secret_token_12345: {"apiKey": "secret_99887766"}';
    const maskedUrl = maskSensitiveCredentials(rawUrl);
    const maskedError = maskSensitiveCredentials(rawError);

    check('PLOG.1', !maskedUrl.includes('sk-abc123456789') && maskedUrl.includes('[REDACTED]'), 'URL API keys are masked');
    check('PLOG.2', !maskedError.includes('my_secret_token_12345') && !maskedError.includes('secret_99887766'), 'Bearer tokens and json keys are masked');

    // Test 2: Log 403 Forbidden failure with payload and token summary
    logProviderFailure({
      provider: 'Bailu',
      baseUrl: 'https://api.bailucode.com/v1',
      model: 'bailu-apex-2.7',
      apiKey: 'sk-bailu-test-key-1234567890',
      operation: 'chat.completions',
      status: 403,
      error: new Error('403 Forbidden - Authorization header invalid'),
      requestPayload: { model: 'bailu-apex-2.7', messages: [{ role: 'user', content: 'hello' }] },
      responseBody: { error: { message: 'Invalid API key provided', code: 'invalid_api_key' } },
      attempt: 1,
      maxRetries: 3,
    });

    check('PLOG.3', fs.existsSync(logFilePath), 'providers.log file is created in logs directory');
    const content = fs.readFileSync(logFilePath, 'utf-8');

    check('PLOG.4', content.includes('[HTTP 403]') && content.includes('[Bailu]'), 'HTTP status and provider name are logged');
    check('PLOG.5', content.includes('operation=chat.completions') && content.includes('model=bailu-apex-2.7'), 'operation and model are recorded');
    check('PLOG.6', content.includes('Token: sk-b...7890'), 'token summary is logged with first/last chars and length');
    check('PLOG.7', content.includes('Request Payload:') && content.includes('"content": "hello"'), 'request payload is formatted and logged');
    check('PLOG.8', content.includes('Invalid API key provided'), 'response body error details are captured');
    check('PLOG.9', content.includes('Remediation: Check your API key in .env'), 'remediation advice is attached for 403 errors');

    // Test 3: Log connection failure
    logProviderFailure({
      provider: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      operation: 'models.list',
      error: 'fetch failed: connect ECONNREFUSED 127.0.0.1:11434',
    });

    const content2 = fs.readFileSync(logFilePath, 'utf-8');
    check('PLOG.10', content2.includes('ECONNREFUSED') && content2.includes('Remediation: Verify that the local or remote LLM server is running'), 'connection errors include server remediation');
  } finally {
    delete process.env.TSUKA_HOME;
    if (oldLogsDir !== undefined) process.env.TSUKA_LOGS_DIR = oldLogsDir;
    else delete process.env.TSUKA_LOGS_DIR;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
