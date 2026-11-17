// The Science flag: off by default, on for moderators, and every Science
// route answers 404 to a reader without it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'reflect-metadata';

const reader = '11111111-1111-4111-8111-111111111111';
const moderator = '44444444-4444-4444-8444-444444444444';
const doi = encodeURIComponent('10.7326/m18-2101');
const ulid = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const uuid = '5f0c2b1e-7a3d-4c8e-9b21-0d6e4f3a2c10';

async function load() {
  const { ScienceService } = await import('../dist/science/science.service.js');
  const { ScienceController } = await import('../dist/science/science.controller.js');
  return { ScienceService, ScienceController };
}

test('the flag is off by default and always on for moderators', async () => {
  const { ScienceService } = await load();
  const service = new ScienceService({}, {});
  const env = { DIALEKTIK_SCIENCE_MODERATORS: moderator.toUpperCase() };
  assert.deepEqual(service.access(reader, env), { enabled: false, moderator: false });
  assert.deepEqual(service.access(moderator, env), { enabled: true, moderator: true });
  assert.deepEqual(service.access(reader, { ...env, DIALEKTIK_SCIENCE_ENABLED: 'true' }), { enabled: true, moderator: false });
  assert.deepEqual(service.access(reader, { ...env, DIALEKTIK_SCIENCE_ENABLED: '1' }), { enabled: false, moderator: false });
});

test('without the flag every Science route is 404, and none reaches the database', async () => {
  const { ScienceService, ScienceController } = await load();
  const touched = [];
  const service = new ScienceService({ get database() { touched.push('database'); throw new Error('no database'); } }, {
    async event() { touched.push('event'); return { body: {} }; },
  });
  const controller = new ScienceController(service, { assertAllowed() {} });
  const request = { betaUserId: reader, ip: '127.0.0.1' };
  const reply = { header() { return reply; } };
  const calls = {
    studies: () => controller.studies(request, reply, 'conectados'),
    study: () => controller.study(request, reply, doi),
    lookup: () => controller.lookup(request, reply, 'measles autism'),
    citing: () => controller.citing(request, reply, doi),
    comments: () => controller.comments(request, reply, ulid),
    addComment: () => controller.addComment(request, ulid, { body: 'Hola' }),
    addStudyComment: () => controller.addStudyComment(request, ulid, { doi: '10.7326/m18-2101', claim_quote_id: ulid,
      relation: 'respalda', abstract_fragment: 'risk', body: 'x' }),
    react: () => controller.react(request, uuid, { reacted: true }),
    myComments: () => controller.myComments(request, reply),
    report: () => controller.report(request, uuid, { reason: 'spam' }),
    resolveReports: () => controller.resolveReports(request, uuid, { decision: 'dismiss' }),
    queue: () => controller.queue(request, reply),
    usage: () => controller.usage(request, reply),
    decide: () => controller.decide(request, uuid, { decision: 'approve' }),
    moderateStudy: () => controller.moderateStudy(request, doi, { design: 'Cohorte' }),
  };
  // Every route handler of the controller is listed above.
  const handlers = Object.getOwnPropertyNames(ScienceController.prototype)
    .filter((name) => name !== 'constructor' && name !== 'access');
  assert.deepEqual(handlers.sort(), Object.keys(calls).sort());
  delete process.env.DIALEKTIK_SCIENCE_ENABLED;
  delete process.env.DIALEKTIK_SCIENCE_MODERATORS;
  for (const [name, call] of Object.entries(calls)) {
    await assert.rejects(call(), (error) => {
      assert.equal(error.getStatus?.(), 404, `${name} must answer 404`);
      assert.equal(error.getResponse().code, 'PUBLIC_NOT_FOUND');
      return true;
    }, name);
  }
  assert.deepEqual(touched, []);
  assert.deepEqual(await controller.access(request, reply), { enabled: false, moderator: false });
});
