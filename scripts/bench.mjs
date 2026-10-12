import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url);
const build = spawn('pnpm', ['--filter', '@askesis/bench...', 'build'], {
  cwd: root,
  stdio: 'inherit',
});
build.on('error', () => {
  console.error('Could not build the benchmark. Run pnpm install first.');
  process.exitCode = 1;
});
build.on('exit', (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  const child = spawn(process.execPath, ['apps/bench/dist/cli.js', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
  });
  // The child gets terminal signals itself. Forward signals sent just to this wrapper too.
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.on('error', () => {
    console.error('Could not start the benchmark.');
    process.exitCode = 1;
  });
  child.on('exit', (exitCode, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = exitCode ?? (signal ? 1 : 0);
  });
});
