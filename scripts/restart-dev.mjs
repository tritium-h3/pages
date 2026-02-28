import { execSync, spawn } from 'node:child_process';

const ports = [5173, 5174, 4173];

function pidsFromPorts() {
  try {
    const output = execSync('ss -ltnp', { encoding: 'utf8' });
    const lines = output.split('\n');
    const pids = new Set();

    for (const line of lines) {
      if (!ports.some((port) => line.includes(`:${port}`))) {
        continue;
      }
      const matches = [...line.matchAll(/pid=(\d+)/g)];
      for (const match of matches) {
        pids.add(Number.parseInt(match[1], 10));
      }
    }

    return [...pids];
  } catch {
    return [];
  }
}

function killPidList(pidList) {
  for (const pid of pidList) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
}

function cleanupWorkspaceProcesses() {
  try {
    execSync(`pkill -f "${process.cwd()}" || true`, { stdio: 'ignore', shell: '/bin/bash' });
  } catch {
    // ignore
  }
}

console.log('Stopping existing dev processes...');
killPidList(pidsFromPorts());
cleanupWorkspaceProcesses();

console.log('Starting fresh dev server...');
const child = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
