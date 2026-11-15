import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMapping, validateMapping, mappingKey } from '../src/loop/mapping.ts';
import type { discoverMock } from '../src/adapter/discovery.ts';
const discovery: Awaited<ReturnType<typeof discoverMock>> = {
  repository: 'owned', workspace: 'synthetic', source: 'local repository', sourceHashes: { tools: 'abc', rules: 'xyz' },
  tools: [{ name: 'update_contact', description: 'Change email', group: 'high', writes: true, arguments: ['contact'], resource: 'Email', testCase: 'email_change', checks: ['code:update_contact'], enforcement: 'Prompt only' }],
};
const sources = [{ file: 'src/store.mjs', text: "case 'update_contact': after.contact = args.contact;", sha256: 'abc' }];
const path = { tool: 'update_contact', resource: 'Email', explanation: 'Changes the email field; a code check is available.', evidence: [{ file: 'src/store.mjs', line: 1, quote: 'after.contact = args.contact' }] };
test('mapping: only known tools with exact source-line citations are accepted', () => {
  assert.deepEqual(validateMapping({ paths: [path] }, discovery, sources), [path]);
  for (const change of [ { tool: 'invented' }, { evidence: [] }, { evidence: [{ ...path.evidence[0], file: '.env' }] }, { evidence: [{ ...path.evidence[0], line: 2 }] }, { evidence: [{ ...path.evidence[0], quote: 'made up implementation' }] } ]) {
    assert.throws(() => validateMapping({ paths: [{ ...path, ...change }] }, discovery, sources));
  }
  assert.throws(() => validateMapping({ paths: [path, path] }, discovery, sources));
});
test('mapping: one bounded model request, source identity retained, no retries', async () => {
  let calls = 0;
  const model = { id: 'test:mapper', vendor: 'test', complete: async (req: { maxTokens?: number }) => {
    calls++; assert.equal(req.maxTokens, 4000);
    return { text: JSON.stringify({ paths: [path] }), usage: { input: 100, output: 50 } };
  } };
  const result = await analyzeMapping(discovery, sources, model);
  assert.equal(calls, 1); assert.equal(result.label, 'Source-cited inference over bounded source excerpts'); assert.equal(result.sourceHashes[0].sha256, 'abc');
  await assert.rejects(analyzeMapping(discovery, sources, { ...model, complete: async () => { calls++; throw new Error('provider unavailable'); } }));
  assert.equal(calls, 2);
  assert.notEqual(mappingKey(sources), mappingKey([{ ...sources[0], sha256: 'changed' }]));
});
