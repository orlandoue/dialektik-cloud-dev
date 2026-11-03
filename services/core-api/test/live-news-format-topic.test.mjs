import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { LiveController } from '../dist/live/live.controller.js';
import { LiveRepository, LIVE_NEWS_TOPIC_PATTERNS } from '../dist/live/live.repository.js';

test('controller forwards validated video and topic filters, preserving old requests', () => {
  const controller = new LiveController({ list: (query) => query });
  assert.deepEqual(controller.news({ format: 'videos', topic: 'politica' }),
    { limit: 25, market: 'CL', format: 'videos', topic: 'politica' });
  assert.deepEqual(controller.news({}), { limit: 25, market: 'CL' });
  for (const value of [{format:'other'},{topic:'unknown'},{topic:'toString'}])
    assert.throws(() => controller.news(value));
});

test('repository applies video and topic filters before pagination', async () => {
  const commands = [];
  const pool = { async connect() { return { async query(command, values) {commands.push({text: typeof command === "string" ? command : command.text, values: values ?? command.values ?? []}); return {rows:[]};}, release() {} };}, async end() {} };
  const database = new Kysely({ dialect: new PostgresDialect({ pool }) });
  try {
    await new LiveRepository(database).list({ limit: 25, format: 'videos', topic: 'politica' });
    assert.match(commands[0].text, /canonical_domain = 'youtube.com'/);
    assert.match(commands[0].text, /~\*/);
    assert.ok(commands[0].values.includes(LIVE_NEWS_TOPIC_PATTERNS.politica));
    assert.match(commands[0].text, /order by published_at desc, id desc limit/i);
  } finally { await database.destroy(); }
});

test('source scope is applied before pagination and only uses server-provided follows', async () => {
  const commands=[];
  const pool={async connect(){return {async query(command,values){commands.push({text:typeof command==='string'?command:command.text,values:values??command.values??[]});return {rows:[]};},release(){}}},async end(){}};
  const db=new Kysely({dialect:new PostgresDialect({pool})});
  try {
    const repo=new LiveRepository(db);
    await repo.list({limit:25,sourceScope:'outside',followedSourceIds:['01K6MYH0000000000000000010'],format:'videos'});
    assert.match(commands[0].text,/not \(source_id::text = any/i);
    assert.ok(commands[0].text.indexOf('source_id::text = any')<commands[0].text.indexOf('order by published_at'));
    assert.ok(commands[0].values.some(value=>Array.isArray(value)&&value.includes('01K6MYH0000000000000000010')));
    commands.length=0;
    await repo.list({limit:25,sourceScope:'following',followedSourceIds:[]});
    assert.match(commands[0].text,/source_id::text = any/i);
  } finally {await db.destroy();}
});
