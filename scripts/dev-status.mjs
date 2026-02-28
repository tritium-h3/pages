import { execSync } from 'node:child_process';

const ports = [5173, 5174, 4173];

function listPortBindings() {
  try {
    const output = execSync('ss -ltnp', { encoding: 'utf8' });
    const lines = output.split('\n');

    return ports
      .map((port) => {
        const matched = lines.filter((line) => line.includes(`:${port}`));
        if (matched.length === 0) {
          return { port, running: false, lines: [] };
        }
        return { port, running: true, lines: matched };
      });
  } catch {
    return ports.map((port) => ({ port, running: false, lines: [] }));
  }
}

const results = listPortBindings();
const anyRunning = results.some((entry) => entry.running);

console.log('Dev status:');
for (const entry of results) {
  if (!entry.running) {
    console.log(`- :${entry.port} free`);
  } else {
    console.log(`- :${entry.port} in use`);
    for (const line of entry.lines) {
      console.log(`  ${line.trim()}`);
    }
  }
}

if (!anyRunning) {
  console.log('\nNo common project dev ports are currently in use.');
}
