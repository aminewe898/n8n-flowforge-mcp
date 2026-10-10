import { spawn } from 'node:child_process';
import { bindSql } from './sql';

export function localRead<T>(select: string, parameters: readonly unknown[] = []): Promise<T> {
  const query = bindSql(select, parameters);
  // Fixed command/argv, no shell. No password, Docker mutation, or user-authored SQL.
  const input = `SET SESSION AUTHORIZATION ticket_owner;
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5000ms';
SET LOCAL lock_timeout='1000ms';
SET LOCAL standard_conforming_strings=on;
${query};
COMMIT;`;
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'ticket-postgres-v1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'ticket_bootstrap', '-d', 'ticket_system'], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Backend unavailable')); }, 10000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) { child.kill(); reject(new Error('Backend response exceeds limit')); } else chunks.push(chunk); });
    child.stderr.on('data', () => {}); // Raw errors may contain private data; never forward or log.
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Backend unavailable')); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error('Backend unavailable')); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8').trim()) as T); } catch { reject(new Error('Invalid backend response')); }
    });
    child.stdin.end(input);
  });
}
