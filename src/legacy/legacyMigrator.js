const fs = require('fs');
const path = require('path');
const promisify = require('util').promisify;
const moment = require('moment');
const uuid = require('uuid');

const knex = require('../knex');
const config = require('../config');
const jsonDb = require('./jsonDb');
const threads = require('../data/threads');

const readDir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const access = promisify(fs.access);
const writeFile = promisify(fs.writeFile);

async function migrate() {
  console.log('Migrating open threads...');
  await migrateOpenThreads();

  console.log('Migrating logs...');
  await migrateLogs();

  console.log('Migrating blocked users...');
  await migrateBlockedUsers();

  console.log('Migrating snippets...');
  await migrateSnippets();

  await writeFile(path.join(config.dbDir, '.migrated_legacy'), '');
}

async function shouldMigrate() {
  // If there is a file marking a finished migration, assume we don't need to migrate
  const migrationFile = path.join(config.dbDir, '.migrated_legacy');
  try {
    await access(migrationFile);
    return false;
  } catch (e) {}

  // If there are any old threads, we need to migrate
  const oldThreads = await jsonDb.get('threads', []);
  if (oldThreads.length) {
    return true;
  }

  // If there are any old blocked users, we need to migrate
  const blockedUsers = await jsonDb.get('blocked', []);
  if (blockedUsers.length) {
    return true;
  }

  // If there are any old snippets, we need to migrate
  const snippets = await jsonDb.get('snippets', {});
  if (Object.keys(snippets).length) {
    return true;
  }

  // If the log file dir exists, we need to migrate
  try {
    await access(config.logDir);
    return true;
  } catch(e) {}

  return false;
}

async function migrateOpenThreads() {
  const oldThreads = await jsonDb.get('threads', []);
  const promises = oldThreads.map(async oldThread => {
    const existingOpenThread = await knex('threads')
      .where('channel_id', oldThread.channelId)
      .first();

    if (existingOpenThread) return;

    const newThread = {
      status: threads.THREAD_STATUS.OPEN,
      user_id: oldThread.userId,
      user_name: oldThread.username,
      channel_id: oldThread.channelId,
      is_legacy: 1
    };

    return threads.create(newThread);
  });

  return Promise.all(promises);
}

async function migrateLogs() {
  const logDir = config.logDir || `${__dirname}/../../logs`;
  const logFiles = await readDir(logDir);

  const promises = logFiles.map(async logFile => {
    if (! logFile.endsWith('.txt')) return;

    const [rawDate, userId, threadId] = logFile.slice(0, -4).split('__');
    const date = `${rawDate.slice(0, 10)} ${rawDate.slice(11).replace('-', ':')}`;

    const fullPath = path.join(logDir, logFile);
    const contents = await readFile(fullPath, {encoding: 'utf8'});

    const newThread = {
      id: threadId,
      status: threads.THREAD_STATUS.CLOSED,
      user_id: userId,
      user_name: '',
      channel_id: null,
      is_legacy: 1,
      created_at: date
    };

    return knex.transaction(async trx => {
      const existingThread = await trx('threads')
        .where('id', newThread.id)
        .first();

      if (existingThread) return;

      await trx('threads').insert(newThread);

      await trx('thread_messages').insert({
        thread_id: newThread.id,
        message_type: threads.THREAD_MESSAGE_TYPE.LEGACY,
        user_id: userId,
        user_name: '',
        body: contents,
        created_at: date
      });
    });
  });

  return Promise.all(promises);
}

async function migrateBlockedUsers() {
  const now = moment.utc().format('YYYY-MM-DD HH:mm:ss');
  const blockedUsers = await jsonDb.get('blocked', []);
  const promises = blockedUsers.map(async userId => {
    const existingBlockedUser = await knex('blocked_users')
      .where('user_id', userId)
      .first();

    if (existingBlockedUser) return;

    return knex('blocked_users').insert({
      user_id: userId,
      user_name: '',
      blocked_by: 0,
      blocked_at: now
    });
  });

  return Promise.all(promises);
}

async function migrateSnippets() {
  const now = moment.utc().format('YYYY-MM-DD HH:mm:ss');
  const snippets = await jsonDb.get('snippets', {});

  const promises = Object.entries(snippets).map(async ([trigger, data]) => {
    const existingSnippet = await knex('snippets')
      .where('trigger', trigger)
      .first();

    if (existingSnippet) return;

    return knex('snippets').insert({
      trigger,
      body: data.text,
      is_anonymous: data.isAnonymous ? 1 : 0,
      created_by: null,
      created_at: now
    });
  });

  return Promise.all(promises);
}

module.exports = {
  migrate,
  shouldMigrate,
};