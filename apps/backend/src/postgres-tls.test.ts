import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { checkServerIdentity, type ConnectionOptions } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { databaseConnectionConfig } from './db/tls.js';

test('Supabase string and object connections retain verified CA and hostname checking after pg URL parsing', () => {
  for (const input of [
    'postgres://user:private@db.example.supabase.co:5432/postgres?sslmode=require&uselibpqcompat=true',
    { connectionString: 'postgres://user:private@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=verify-full' },
    { host: 'db.example.supabase.co', user: 'user', password: 'private' },
  ]) {
    const normalized = databaseConnectionConfig(input);
    const client = new pg.Client(normalized); // No connect: no database or network involved.
    const ssl = (client as any).connectionParameters.ssl as ConnectionOptions;
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.checkServerIdentity, checkServerIdentity);
    assert.match(String(ssl.ca), /BEGIN CERTIFICATE/);
    const ca = new X509Certificate(String(ssl.ca));
    assert.equal(ca.fingerprint256.replaceAll(':', ''), '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA');
    assert.equal(ssl.checkServerIdentity!('wrong.example', { subjectaltname: `DNS:${ssl.servername}`, subject: { CN: ssl.servername! } } as any)?.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    assert.equal(ssl.checkServerIdentity!(ssl.servername!, { subjectaltname: `DNS:${ssl.servername}`, subject: { CN: ssl.servername! } } as any), undefined);
  }
});

test('Supabase rejects disabled verification and replaces custom identity checkers', () => {
  const host = 'db.example.supabase.co';
  for (const mode of ['disable', 'prefer', 'allow', 'no-verify']) assert.throws(() => databaseConnectionConfig(`postgres://user:private@${host}/postgres?sslmode=${mode}`), /insecure SSL/);
  assert.throws(() => databaseConnectionConfig({ host, ssl: false }), /insecure SSL/);
  assert.throws(() => databaseConnectionConfig({ host, ssl: { rejectUnauthorized: false } }), /insecure SSL/);
  assert.throws(() => databaseConnectionConfig(`postgres://user:private@${host}/postgres?ssl=0`), /insecure SSL/);
  assert.throws(() => databaseConnectionConfig(`postgres://user:private@${host}/postgres?host=attacker.example`), /host overrides/);
  const config = databaseConnectionConfig({ host, ssl: { checkServerIdentity: () => undefined } });
  assert.equal((config.ssl as ConnectionOptions).checkServerIdentity, checkServerIdentity);
});

test('missing, invalid or expired CA fails closed with no credential-bearing errors', () => {
  const oldFile = process.env.HAVEN_DATABASE_CA_FILE;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-tls-'));
  const clock = Date.now;
  try {
    const file = path.join(directory, 'ca.pem');
    process.env.HAVEN_DATABASE_CA_FILE = file;
    assert.throws(() => databaseConnectionConfig('postgres://user:private@db.example.supabase.co/postgres'), error => error instanceof Error && /CA certificate/.test(error.message) && !error.message.includes('private'));
    fs.writeFileSync(file, 'not a trusted certificate');
    assert.throws(() => databaseConnectionConfig({ host: 'db.example.supabase.co' }), /CA certificate/);
    delete process.env.HAVEN_DATABASE_CA_FILE;
    Date.now = () => Date.UTC(2032, 0, 1);
    assert.throws(() => databaseConnectionConfig({ host: 'db.example.supabase.co' }), /CA certificate/);
  } finally {
    Date.now = clock;
    if (oldFile === undefined) delete process.env.HAVEN_DATABASE_CA_FILE; else process.env.HAVEN_DATABASE_CA_FILE = oldFile;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('localhost PostgreSQL configuration is unchanged and pool options are not mutated', () => {
  const input = { host: '127.0.0.1', port: 5432, ssl: false as const, max: 3 };
  assert.deepEqual(databaseConnectionConfig(input), input);
  assert.notEqual(databaseConnectionConfig(input), input);
});
