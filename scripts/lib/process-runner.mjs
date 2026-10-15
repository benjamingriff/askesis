import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

// Keep the process-group leader alive until the command AND its descendants stop.
// The supervisor records this PID's birth identity, so recovery never targets a
// recycled launcher PID. IPC disconnect also cleans children after parent death.
const [grace, command, ...args] = process.argv.slice(2);
const graceMilliseconds = Number(grace);
let child;
let result;
let stopping = false;
let deadline;
let polling;

function groupHasChildren() {
  if (process.platform === 'linux') {
    return readdirSync('/proc').some((pid) => {
      if (!/^\d+$/.test(pid) || Number(pid) === process.pid) return false;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return fields[0] !== 'Z' && Number(fields[2]) === process.pid;
      } catch {
        return false;
      }
    });
  }
  if (process.platform === 'win32') return child?.exitCode === null && child?.signalCode === null;
  return execFileSync('ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .some((line) => {
      const [pid, group, state] = line.trim().split(/\s+/);
      return Number(pid) !== process.pid && Number(group) === process.pid && !state.startsWith('Z');
    });
}

function finish() {
  if (!result || groupHasChildren()) return;
  clearTimeout(deadline);
  clearInterval(polling);
  process.exit(result.code ?? 1);
}

function stop() {
  if (stopping) return;
  stopping = true;
  // The guard catches its own group signal; the stopping flag prevents recursion.
  if (process.platform === 'win32') child?.kill('SIGTERM');
  else process.kill(-process.pid, 'SIGTERM');
  deadline = setTimeout(() => {
    const kill = () => {
      if (process.platform === 'win32') {
        child?.kill('SIGKILL');
        process.exit(1);
      } else process.kill(-process.pid, 'SIGKILL');
    };
    if (process.connected) process.send({ type: 'forced-stop', result }, kill);
    else kill();
  }, graceMilliseconds);
  polling = setInterval(finish, 25);
  finish();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('disconnect', stop);
child = spawn(command, args, { stdio: 'inherit' });
child.once('error', () => {
  result = { code: 1 };
  stop();
});
child.once('exit', (code, signal) => {
  result = { code, signal };
  stop();
});
