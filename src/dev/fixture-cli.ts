import { resolve } from 'node:path';

import { createManualFixture } from './manual-fixture.js';

const argumentsList = process.argv.slice(2);
if (argumentsList.length > 1) {
  process.stderr.write('Usage: npm run fixture:create -- [destination]\n');
  process.exitCode = 1;
} else {
  const destination = argumentsList[0] ?? resolve('.nix', 'manual-test-app');
  try {
    const created = await createManualFixture(destination);
    process.stdout.write(`Created disposable manual test app at ${created}\n`);
    process.stdout.write(
      'Its Git baseline is clean. Register this directory as a Nix workspace.\n',
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
