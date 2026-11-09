import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStorage } from '../src/storage.js';

test('is off without S3_BUCKET', () => {
  assert.equal(createStorage({}), null);
});

test('uploads the image with its content type', async () => {
  const sent = [];
  const fakeClient = { send: async (command) => sent.push(command.input) };
  const storage = createStorage({ S3_BUCKET: 'shots' }, fakeClient);

  const image = Buffer.from('fake image');
  const saved = await storage.save(image, 'image/webp', 'webp');

  assert.equal(saved.bucket, 'shots');
  assert.match(saved.key, /^screenshots\/[0-9a-f-]{36}\.webp$/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].Bucket, 'shots');
  assert.equal(sent[0].Key, saved.key);
  assert.equal(sent[0].Body, image);
  assert.equal(sent[0].ContentType, 'image/webp');
});
