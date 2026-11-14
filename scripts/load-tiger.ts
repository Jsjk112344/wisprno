import { readInputs } from '../src/tiger/input.ts';
import { connection, loadArchive, projectRoot } from '../src/tiger/database.ts';

const input = readInputs(projectRoot);
console.log(JSON.stringify({ files: input.fileCount, events: input.events.length, fixes: input.fixes.length, sources: input.counts }, null, 2));
if (!process.argv.includes('--dry-run')) {
  const client = connection();
  try {
    await client.connect();
    let last = 0;
    console.log(JSON.stringify(await loadArchive(client, input, (table, staged, total) => {
      if (staged - last >= 5000 || staged === total) { console.log(`${table}: staged ${staged} of ${total}`); last = staged; }
    }), null, 2));
  } finally {
    await client.end();
  }
}
