import { spawn } from 'node:child_process';

const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.pid) {
      try {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}

for (const name of ['dev:api', 'dev:web']) {
  const child = spawn('pnpm', [name], {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('error', () => {
    console.error(`Could not start ${name}.`);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
