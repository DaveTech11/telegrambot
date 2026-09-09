
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const config = require('./config');

// ---------- Render Web Service health server ----------
const http = require('http');
const PORT = Number(process.env.PORT) || 10000;

const healthServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Xryon Telegram bot is running');
});

healthServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Health server listening on 0.0.0.0:${PORT}`);
});


const bot = new Telegraf(config.BOT_TOKEN);

// ---------- Bot identity from BOT_TOKEN ----------
let BOT_INFO = null;

async function loadBotInfo() {
  try {
    BOT_INFO = await bot.telegram.getMe();
    return BOT_INFO;
  } catch (error) {
    console.error(`❌ Could not read bot identity: ${error.message}`);
    return null;
  }
}

function botIdentityText(info = BOT_INFO) {
  if (!info) return '❌ Bot identity unavailable.';
  const username = info.username ? `@${info.username}` : '(no username set)';
  const name = [info.first_name, info.last_name].filter(Boolean).join(' ') || 'Unnamed';
  return `🤖 Bot: ${name}\n👤 Username: ${username}\n🆔 ID: ${info.id}`;
}

// ---------- Color system ----------
// Telegram Bot API does not provide arbitrary font-color styling. This
// color system gives messages a consistent visual theme using color-coded
// emoji indicators and Telegram HTML formatting.
const COLOR_THEMES = {
  blue:       { primary: '🔵', success: '🟢', warning: '🟡', danger: '🔴', info: '🔷', accent: '🔹' },
  green:      { primary: '🟢', success: '✅', warning: '🟡', danger: '🔴', info: '🟩', accent: '🌿' },
  red:        { primary: '🔴', success: '🟢', warning: '🟠', danger: '⛔', info: '🔺', accent: '♦️' },
  purple:     { primary: '🟣', success: '🟢', warning: '🟡', danger: '🔴', info: '🟪', accent: '💜' },
  gold:       { primary: '🟡', success: '🟢', warning: '🟠', danger: '🔴', info: '⭐', accent: '✨' },
  monochrome: { primary: '⚪', success: '✅', warning: '⚠️', danger: '❌', info: '◻️', accent: '▪️' }
};

function getColors() {
  const settings = config.COLOR_SYSTEM || {};
  return COLOR_THEMES[settings.theme] || COLOR_THEMES.blue;
}

function themed(kind, text, options = {}) {
  const settings = config.COLOR_SYSTEM || {};
  if (!settings.enabled) return text;
  const colors = getColors();
  const icon = colors[kind] || colors.primary;
  const body = settings.boldHeadings && options.heading
    ? `<b>${escapeHtml(text)}</b>`
    : escapeHtml(text);
  return settings.prefix === false ? body : `${icon} ${body}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colorThemeName() {
  return (config.COLOR_SYSTEM && config.COLOR_SYSTEM.theme) || 'blue';
}

function colorHelpText() {
  return [
    `<b>🎨 Color System</b>`,
    ``,
    `Theme: <code>${escapeHtml(colorThemeName())}</code>`,
    `Status: ${(config.COLOR_SYSTEM && config.COLOR_SYSTEM.enabled) ? '🟢 enabled' : '🔴 disabled'}`,
    ``,
    `<b>Available themes</b>`,
    `🔵 blue  •  🟢 green  •  🔴 red`,
    `🟣 purple  •  🟡 gold  •  ⚪ monochrome`,
    ``,
    `Change the default theme in <code>config.js</code>.`
  ].join('\\n');
}

// ---------- Persisted custom schedules (added at runtime via /schedule) ----------

const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');
const jobs = new Map(); // id -> cron task

function loadSchedules() {
  if (!fs.existsSync(SCHEDULES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSchedules(list) {
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(list, null, 2));
}

function registerJob(entry) {
  const [hour, minute] = entry.time.split(':').map(Number);
  const task = cron.schedule(`${minute} ${hour} * * *`, () => {
    broadcast({ text: entry.text, imagePath: entry.imagePath || null });
  });
  jobs.set(entry.id, task);
}

function loadCustomSchedules() {
  for (const entry of loadSchedules()) registerJob(entry);
}

async function isBotAdmin(chatId) {
  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(chatId, me.id);
    return member.status === 'administrator' || member.status === 'creator';
  } catch (e) {
    console.warn(`Admin check failed for ${chatId}: ${e.message}`);
    return false;
  }
}


// ---------- Owner-selected broadcast targets ----------
const BROADCAST_TARGETS_FILE = path.join(__dirname, 'data', 'broadcast-targets.json');

function ensureBroadcastTargetStorage() {
  fs.mkdirSync(path.dirname(BROADCAST_TARGETS_FILE), { recursive: true });
  if (!fs.existsSync(BROADCAST_TARGETS_FILE)) {
    fs.writeFileSync(BROADCAST_TARGETS_FILE, JSON.stringify([], null, 2));
  }
}

function loadBroadcastTargets() {
  ensureBroadcastTargetStorage();
  try {
    const list = JSON.parse(fs.readFileSync(BROADCAST_TARGETS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveBroadcastTargets(list) {
  ensureBroadcastTargetStorage();
  fs.writeFileSync(BROADCAST_TARGETS_FILE, JSON.stringify(list, null, 2));
}

function targetIsSelected(chatId) {
  return loadBroadcastTargets().some(x => String(x.id) === String(chatId));
}

function selectedTargetIds() {
  return loadBroadcastTargets().map(x => String(x.id));
}

function addBroadcastTarget(chat) {
  const list = loadBroadcastTargets();
  if (!list.some(x => String(x.id) === String(chat.id))) {
    list.push({
      id: String(chat.id),
      title: chat.title || chat.username || String(chat.id),
      username: chat.username || '',
      type: chat.type || ''
    });
    saveBroadcastTargets(list);
  }
}

function removeBroadcastTarget(chatId) {
  saveBroadcastTargets(loadBroadcastTargets().filter(x => String(x.id) !== String(chatId)));
}

function upsertKnownDestination(chat) {
  if (!chat || !chat.id) return;
  const allowed = chat.type === 'channel' || chat.type === 'group' || chat.type === 'supergroup';
  if (!allowed) return;

  const list = loadBroadcastTargets();
  const existing = list.find(x => String(x.id) === String(chat.id));

  if (existing) {
    existing.title = chat.title || chat.username || existing.title || String(chat.id);
    existing.username = chat.username || existing.username || '';
    existing.type = chat.type || existing.type || '';
  } else {
    list.push({
      id: String(chat.id),
      title: chat.title || chat.username || String(chat.id),
      username: chat.username || '',
      type: chat.type || ''
    });
  }

  saveBroadcastTargets(list);
}

async function discoverAndTrackChat(chat) {
  if (!chat || !chat.id) return false;

  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(chat.id, me.id);
    const isAdmin = member.status === 'administrator' || member.status === 'creator';

    if (isAdmin && (chat.type === 'channel' || chat.type === 'group' || chat.type === 'supergroup')) {
      upsertKnownDestination(chat);
      return true;
    }
  } catch (e) {
    console.warn(`Could not discover chat ${chat.id}: ${e.message}`);
  }

  return false;
}


async function getAdminChannelsAndGroups() {
  const configured = [...new Set([
    ...(config.TARGET_CHATS || []).map(String),
    ...loadBroadcastTargets().map(x => String(x.id))
  ])];

  // The Bot API does not expose a general list-all-admin-chats endpoint.
  // Xryon tracks chats from my_chat_member/channel_post/message updates and can
  // also register a known channel explicitly with /addchannel.
  const results = [];

  for (const chatId of configured) {
    try {
      const chat = await bot.telegram.getChat(chatId);
      const me = await bot.telegram.getMe();
      const member = await bot.telegram.getChatMember(chat.id, me.id);
      const isAdmin = member.status === 'administrator' || member.status === 'creator';
      if (isAdmin && (chat.type === 'channel' || chat.type === 'group' || chat.type === 'supergroup')) {
        results.push({
          id: String(chat.id),
          title: chat.title || chat.username || String(chat.id),
          username: chat.username || '',
          type: chat.type,
          selected: targetIsSelected(chat.id)
        });
      }
    } catch (e) {
      console.warn(`Could not inspect broadcast target ${chatId}: ${e.message}`);
    }
  }

  return results;
}

async function broadcast({ text, imagePath, targets } = {}) {
  const chats = [...new Set((targets || selectedTargetIds()).map(String))];
  let sent = 0;
  let failed = 0;
  const failures = [];

  if (!chats.length) return { sent: 0, failed: 0, failures: [], targets: [] , reason: 'no-targets' };

  for (const chatId of chats) {
    const admin = await isBotAdmin(chatId);
    if (!admin) {
      failed++;
      failures.push(`${chatId}: bot is not admin or chat is inaccessible`);
      continue;
    }

    try {
      if (imagePath) {
        const photoResult = await sendPhotoWithRetry(chatId, imagePath, text || '');
        if (!photoResult.ok) throw new Error(photoResult.error);
      } else if (text) {
        await bot.telegram.sendMessage(chatId, text);
      } else {
        throw new Error('empty message');
      }
      sent++;
    } catch (e) {
      failed++;
      failures.push(`${chatId}: ${e.message}`);
      console.error(`Failed to send to ${chatId}: ${e.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  return { sent, failed, failures, targets: chats };
}

function isOwner(ctx) {
  return !!ctx.from && config.OWNER_IDS.includes(ctx.from.id);
}

// ---------- Public (decoy) menu shown to every user ----------
// These are the ONLY commands registered in Telegram's own "/" menu (setMyCommands),
// so regular users never see the admin commands listed there at all.

const publicKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('ℹ️ Help', 'pub_help'), Markup.button.callback('📖 About', 'pub_about')],
  [Markup.button.callback('👤 My Profile', 'pub_profile'), Markup.button.callback('📡 Channels', 'pub_channels')],
  [Markup.button.callback('⚙️ Settings', 'pub_settings')],
]);

function xryonWelcomeText() {
  return [
    '<b>✦ XRYON</b>',
    '',
    'Welcome 👋',
    '',
    'A simple Telegram utility for updates, media, channels and scheduled posts.',
    '',
    '<b>Quick access</b>',
    'ℹ️ Help  •  📖 About',
    '👤 Profile  •  📡 Channels',
    '⚙️ Settings',
    '',
    'Use the buttons below to explore.'
  ].join('\n');
}

bot.start(async (ctx) => {
  await ctx.reply(xryonWelcomeText(), {
    ...publicKeyboard,
    parse_mode: 'HTML'
  });
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      '<b>ℹ️ XRYON HELP</b>',
      '',
      'Available commands:',
      '/start — Open Xryon',
      '/help — Show help',
      '/about — About Xryon',
      '/profile — View your profile',
      '/channels — Owner broadcast destinations',
      '/compose — Owner broadcast composer',
      '',
      'Owner-only tools are available only to authorized owners.'
    ].join('\n'),
    { parse_mode: 'HTML' }
  );
});

bot.command('about', async (ctx) => {
  await ctx.reply(
    [
      '<b>📖 ABOUT XRYON</b>',
      '',
      'Xryon is a Telegram utility and broadcast assistant.',
      '',
      '• Channel/group posting',
      '• Scheduled updates',
      '• Media broadcasting',
      '• Admin controls',
      '• Owner-only management tools'
    ].join('\n'),
    { parse_mode: 'HTML' }
  );
});

bot.command('profile', async (ctx) => {
  const u = ctx.from;
  const username = u.username ? `@${escapeHtml(u.username)}` : 'Not set';
  await ctx.reply(
    [
      '<b>👤 YOUR XRYON PROFILE</b>',
      '',
      `<b>Name:</b> ${escapeHtml([u.first_name, u.last_name].filter(Boolean).join(' ') || 'Unknown')}`,
      `<b>Username:</b> ${username}`,
      `<b>Telegram ID:</b> <code>${u.id}</code>`
    ].join('\n'),
    { parse_mode: 'HTML' }
  );
});

bot.action('pub_help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '<b>ℹ️ HELP</b>\n\nUse /start to open Xryon, /profile to view your profile, and /about to learn about the bot.',
    { parse_mode: 'HTML' }
  );
});

bot.action('pub_about', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '<b>📖 ABOUT</b>\n\nXryon is a Telegram utility and broadcast assistant.',
    { parse_mode: 'HTML' }
  );
});

bot.action('pub_profile', async (ctx) => {
  await ctx.answerCbQuery();
  const u = ctx.from;
  await ctx.reply(
    `<b>👤 PROFILE</b>\n\nName: ${escapeHtml([u.first_name, u.last_name].filter(Boolean).join(' ') || 'Unknown')}\nUsername: ${u.username ? '@' + escapeHtml(u.username) : 'Not set'}`,
    { parse_mode: 'HTML' }
  );
});

bot.action('pub_channels', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '📡 Channel tools are available to authorized owners. Use /channels to manage selected broadcast destinations.',
    { parse_mode: 'HTML' }
  );
});

bot.action('pub_settings', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '<b>⚙️ SETTINGS</b>\n\nPublic settings are limited. Owner controls are protected by authorization checks.',
    { parse_mode: 'HTML' }
  );
});

// ---------- Hidden admin panel — unlocked only via /admin, only for OWNER_IDS ----------
// /admin itself is never listed in the bot's command menu for anyone, and does nothing
// visible when a non-owner sends it (no reply, no error) — it just looks like an unknown command.

const adminKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🤖 Bot info', 'adm_bot_info')],
  [Markup.button.callback('📊 Status', 'adm_status')],
  [Markup.button.callback('📋 List Schedules', 'adm_schedules')],
  [Markup.button.callback('📨 Send now (how)', 'adm_send_help')],
  [Markup.button.callback('🖼 Set picture (how)', 'adm_setpic_help')],
  [Markup.button.callback('⏰ Schedule a post (how)', 'adm_schedule_help')],
  [Markup.button.callback('🗑 Remove a schedule (how)', 'adm_unschedule_help')],
  [Markup.button.callback('📡 Select broadcast channels', 'adm_broadcast_channels')],
]);

bot.command('admin', async (ctx) => {
  if (!isOwner(ctx)) return; // silent — looks like the command doesn't exist
  await ctx.reply(`${themed('success', 'Admin panel unlocked.', { heading: true })}`, { parse_mode: 'HTML', ...adminKeyboard });
});

bot.action('adm_bot_info', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  const info = await loadBotInfo();
  await ctx.reply(botIdentityText(info));
});

bot.command('botinfo', async (ctx) => {
  if (!isOwner(ctx)) return;
  const info = await loadBotInfo();
  await ctx.reply(botIdentityText(info));
});

bot.action('adm_status', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  const lines = [];
  for (const chat of config.TARGET_CHATS) {
    const ok = await isBotAdmin(chat);
    lines.push(`${chat}: ${ok ? 'admin ✅' : 'not admin ❌'}`);
  }
  await ctx.reply(lines.length ? lines.map(x => x.replace(': admin ✅', `: ${getColors().success} admin`)).join('\n') : themed('warning', 'No target chats configured.'));
});

bot.action('adm_schedules', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  const list = loadSchedules();
  if (!list.length) return ctx.reply(themed('warning', 'No custom schedules set.'));
  const lines = list.map((e) => `${e.id} — ${e.time} — ${e.text}${e.imagePath ? ' 📷' : ''}`);
  await ctx.reply(lines.join('\n'));
});

bot.action('adm_send_help', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await ctx.reply('Type: /send <message>\nSends it to your selected broadcast channels/groups. Use /channels to select them.');
});

bot.action('adm_setpic_help', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await ctx.reply('Reply to a photo with /setpic to make it the bot\'s new avatar.');
});


// Owner-only: change the bot's own Telegram profile picture using the Bot API.
// Usage: send a photo, then reply to that photo with /setpic.
// Telegram requires the profile photo to be uploaded as a file, so we download
// the replied Telegram photo and upload it as multipart/form-data.
bot.command('setpic', async (ctx) => {
  if (!isOwner(ctx)) return;

  const replied = ctx.message.reply_to_message;
  if (!replied || !replied.photo || !replied.photo.length) {
    return ctx.reply('🖼️ Reply to a photo with /setpic to change my profile picture.');
  }

  try {
    const largest = replied.photo[replied.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(largest.file_id);
    const photoResponse = await fetch(fileLink.href);
    if (!photoResponse.ok) throw new Error(`Could not download photo: HTTP ${photoResponse.status}`);

    const photoBuffer = Buffer.from(await photoResponse.arrayBuffer());
    const form = new FormData();
    const photoBlob = new Blob([photoBuffer], { type: 'image/jpeg' });

    form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://profile_photo' }));
    form.append('profile_photo', photoBlob, 'profile.jpg');

    const apiResponse = await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/setMyProfilePhoto`, {
      method: 'POST',
      body: form
    });
    const result = await apiResponse.json();

    if (!result.ok) throw new Error(result.description || 'Telegram API error');

    await ctx.reply('✅ Bot profile picture updated successfully.');
  } catch (error) {
    console.error('setpic error:', error);
    await ctx.reply(`❌ Failed to update profile picture.\n${error.description || error.message || 'Telegram API error'}`);
  }
});

bot.action('adm_schedule_help', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await ctx.reply('Type: /schedule HH:MM <message>\nReply to a photo first to attach an image.\nExample: /schedule 14:30 Good afternoon!');
});

bot.action('adm_unschedule_help', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await ctx.reply('Type: /unschedule <id>\nGet ids from the "List Schedules" button.');
});



// ---------- XRYON Broadcast Composer ----------
const BROADCAST_HISTORY_FILE = path.join(__dirname, 'data', 'broadcast-history.json');
const BROADCAST_DRAFT = new Map(); // ownerId -> draft
const BROADCAST_PREVIEWS = new Map(); // ownerId -> preview data

function ensureHistoryStorage() {
  fs.mkdirSync(path.dirname(BROADCAST_HISTORY_FILE), { recursive: true });
  if (!fs.existsSync(BROADCAST_HISTORY_FILE)) {
    fs.writeFileSync(BROADCAST_HISTORY_FILE, JSON.stringify([], null, 2));
  }
}

function loadBroadcastHistory() {
  ensureHistoryStorage();
  try {
    const value = JSON.parse(fs.readFileSync(BROADCAST_HISTORY_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveBroadcastHistory(list) {
  ensureHistoryStorage();
  fs.writeFileSync(BROADCAST_HISTORY_FILE, JSON.stringify(list, null, 2));
}

function recordBroadcast(entry) {
  const list = loadBroadcastHistory();
  list.unshift({
    id: Date.now().toString(36),
    createdAt: new Date().toISOString(),
    ...entry
  });
  saveBroadcastHistory(list.slice(0, 100));
}

function getDraft(ownerId) {
  return BROADCAST_DRAFT.get(String(ownerId)) || {
    text: '',
    imagePath: null,
    imageName: null,
    mode: 'send'
  };
}

function setDraft(ownerId, patch) {
  const current = getDraft(ownerId);
  const next = { ...current, ...patch };
  BROADCAST_DRAFT.set(String(ownerId), next);
  return next;
}

function clearDraft(ownerId) {
  BROADCAST_DRAFT.delete(String(ownerId));
  BROADCAST_PREVIEWS.delete(String(ownerId));
}

function broadcastComposerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🖼 Add image', 'bc_add_image')],
    [Markup.button.callback('✏️ Set text', 'bc_set_text')],
    [Markup.button.callback('👀 Preview', 'bc_preview')],
    [Markup.button.callback('📡 Destinations', 'bc_open_destinations')],
    [Markup.button.callback('📤 Send now', 'bc_send')],
    [Markup.button.callback('⏰ Schedule', 'bc_schedule')],
    [Markup.button.callback('🗑 Clear', 'bc_clear')]
  ]);
}

function formatComposerText(ownerId) {
  const d = getDraft(ownerId);
  const destinations = loadBroadcastTargets();
  return [
    '<b>💎 XRYON BROADCAST COMPOSER</b>',
    '',
    `<b>Destinations:</b> ${destinations.length}`,
    `<b>Image:</b> ${d.imagePath ? escapeHtml(d.imageName || 'saved image') : 'none'}`,
    `<b>Text:</b> ${d.text ? 'set' : 'none'}`,
    '',
    d.text ? `<blockquote>${escapeHtml(d.text)}</blockquote>` : 'No caption/message set yet.',
    '',
    'Choose an action below.'
  ].join('\n');
}

async function showComposer(ctx) {
  if (!isOwner(ctx)) return;
  await ctx.reply(formatComposerText(ctx.from.id), {
    parse_mode: 'HTML',
    ...broadcastComposerKeyboard()
  });
}

async function sendComposerNow(ctx) {
  const ownerId = ctx.from.id;
  const d = getDraft(ownerId);
  const targets = selectedTargetIds();

  if (!targets.length) return ctx.reply('❌ No destinations selected. Open Destinations first.');
  if (!d.text && !d.imagePath) return ctx.reply('❌ Add a message or image first.');

  let sent = 0, failed = 0, failures = [];

  for (const chatId of targets) {
    try {
      const ok = await isBotAdmin(chatId);
      if (!ok) throw new Error('Bot is not admin in this destination.');

      if (d.imagePath) {
        await sendPhotoWithRetry(chatId, d.imagePath, d.text || '');
      } else {
        await bot.telegram.sendMessage(chatId, d.text);
      }
      sent++;
    } catch (e) {
      failed++;
      failures.push(`${chatId}: ${e.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  recordBroadcast({
    mode: 'manual',
    ownerId: String(ownerId),
    targets,
    sent,
    failed,
    hasImage: !!d.imagePath,
    text: d.text || '',
    failures
  });

  clearDraft(ownerId);

  let report = `<b>📊 BROADCAST COMPLETE</b>\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`;
  if (failures.length) {
    report += '\n\n<b>Failures</b>\n' + failures.slice(0, 10).map(escapeHtml).join('\n');
  }
  await ctx.reply(report, { parse_mode: 'HTML' });
}

bot.command('broadcast', async (ctx) => {
  if (!isOwner(ctx)) return;
  setDraft(ctx.from.id, { text: ctx.message.text.replace(/^\/broadcast\s*/i, '').trim() });
  await showComposer(ctx);
});

bot.command('compose', async (ctx) => {
  if (!isOwner(ctx)) return;
  await showComposer(ctx);
});

bot.action('bc_open_destinations', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await showBroadcastSelector(ctx);
});

bot.action('bc_add_image', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await ctx.reply('🖼️ Send a photo now. I will attach it to the Xryon broadcast draft.');
  BROADCAST_PREVIEWS.set(String(ctx.from.id), { waitingForImage: true });
});

bot.action('bc_set_text', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  BROADCAST_PREVIEWS.set(String(ctx.from.id), { waitingForText: true });
  await ctx.reply('✏️ Send the caption/message for this broadcast.');
});

bot.action('bc_preview', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  const d = getDraft(ctx.from.id);
  if (!d.text && !d.imagePath) return ctx.reply('❌ Your draft is empty.');
  const targets = loadBroadcastTargets();
  await ctx.reply(
    [
      '<b>👀 BROADCAST PREVIEW</b>',
      '',
      `<b>Destinations:</b> ${targets.length}`,
      `<b>Image:</b> ${d.imagePath ? 'yes' : 'no'}`,
      '',
      d.text ? `<blockquote>${escapeHtml(d.text)}</blockquote>` : 'No text/caption.'
    ].join('\n'),
    { parse_mode: 'HTML' }
  );
  if (d.imagePath && fs.existsSync(d.imagePath)) {
    await ctx.replyWithPhoto({ source: d.imagePath }, { caption: d.text || undefined });
  }
});

bot.action('bc_send', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await sendComposerNow(ctx);
});

bot.action('bc_schedule', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await ctx.reply('⏰ Scheduling from the composer: use /schedule HH:MM <message> (reply to a photo to attach it).');
});

bot.action('bc_clear', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  clearDraft(ctx.from.id);
  await ctx.answerCbQuery('Draft cleared');
  await ctx.reply('🗑️ Broadcast draft cleared.');
});

// Capture owner text/photo for the composer only when they explicitly entered composer mode.
bot.on('photo', async (ctx, next) => {
  if (!isOwner(ctx)) return next();
  const state = BROADCAST_PREVIEWS.get(String(ctx.from.id));
  if (!state?.waitingForImage) return next();

  try {
    ensureImageAutoBroadcastStorage();
    const largest = ctx.message.photo[ctx.message.photo.length - 1];
    IMAGE_AUTO_BROADCAST.state.fileId = largest.file_id;
    const link = await ctx.telegram.getFileLink(largest.file_id);
    const res = await fetch(link.href);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const filePath = path.join(IMAGE_AUTO_BROADCAST.mediaDir, `composer-${Date.now()}.jpg`);
    fs.writeFileSync(filePath, buffer);
    setDraft(ctx.from.id, { imagePath: filePath, imageName: 'composer-image.jpg' });
    BROADCAST_PREVIEWS.delete(String(ctx.from.id));
    await ctx.reply(formatComposerText(ctx.from.id), { parse_mode: 'HTML', ...broadcastComposerKeyboard() });
  } catch (e) {
    console.error('Composer image error:', e);
    await ctx.reply('❌ Could not attach that image.');
  }
});

bot.on('text', async (ctx, next) => {
  if (!isOwner(ctx)) return next();
  const state = BROADCAST_PREVIEWS.get(String(ctx.from.id));
  if (!state?.waitingForText) return next();

  setDraft(ctx.from.id, { text: ctx.message.text });
  BROADCAST_PREVIEWS.delete(String(ctx.from.id));
  await ctx.reply(formatComposerText(ctx.from.id), { parse_mode: 'HTML', ...broadcastComposerKeyboard() });
});

bot.command('broadcasts', async (ctx) => {
  if (!isOwner(ctx)) return;
  const list = loadBroadcastHistory();
  if (!list.length) return ctx.reply('📊 No broadcast history yet.');
  const lines = list.slice(0, 10).map((x, i) =>
    `${i + 1}. ${x.createdAt}\n✅ ${x.sent}  ❌ ${x.failed}  📡 ${x.targets.length}`
  );
  await ctx.reply('<b>📊 RECENT BROADCASTS</b>\n\n' + lines.join('\n\n'), { parse_mode: 'HTML' });
});


// ---------- Automatic channel/group discovery ----------
// Telegram sends a my_chat_member update when this bot is added, removed,
// or promoted in a chat. Track newly discovered admin destinations automatically.
bot.on('my_chat_member', async (ctx, next) => {
  try {
    const chat = ctx.myChatMember?.chat;
    const newStatus = ctx.myChatMember?.new_chat_member?.status;

    if (
      chat &&
      (chat.type === 'channel' || chat.type === 'group' || chat.type === 'supergroup') &&
      (newStatus === 'administrator' || newStatus === 'creator')
    ) {
      upsertKnownDestination(chat);
      console.log(`📡 Discovered admin destination: ${chat.title || chat.username || chat.id}`);
    }
  } catch (e) {
    console.warn(`my_chat_member discovery failed: ${e.message}`);
  }

  return next();
});

// Also learn channel/group metadata from messages the bot actually receives there.
bot.on('channel_post', async (ctx, next) => {
  try {
    await discoverAndTrackChat(ctx.chat);
  } catch (e) {
    console.warn(`channel_post discovery failed: ${e.message}`);
  }
  return next();
});

bot.on('message', async (ctx, next) => {
  try {
    if (
      ctx.chat &&
      (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')
    ) {
      await discoverAndTrackChat(ctx.chat);
    }
  } catch (_) {}
  return next();
});

// Manual registration is useful for channels that were added before the bot
// started tracking membership updates.
bot.command('addchannel', async (ctx) => {
  if (!isOwner(ctx)) return;

  const target = ctx.message.text.replace(/^\/addchannel\s*/i, '').trim();
  if (!target) {
    return ctx.reply('Usage: /addchannel @channelusername or /addchannel -1001234567890');
  }

  try {
    const chat = await ctx.telegram.getChat(target);
    const me = await ctx.telegram.getMe();
    const member = await ctx.telegram.getChatMember(chat.id, me.id);
    const isAdmin = member.status === 'administrator' || member.status === 'creator';

    if (!isAdmin) {
      return ctx.reply('❌ The bot is not an admin in that channel/group.');
    }

    upsertKnownDestination(chat);
    await ctx.reply(
      `✅ Added <b>${escapeHtml(chat.title || chat.username || String(chat.id))}</b> to the channel selector.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    await ctx.reply(`❌ Could not add that channel/group: ${e.message}`);
  }
});


bot.command('syncchannels', async (ctx) => {
  if (!isOwner(ctx)) return;

  const candidates = await getAdminChannelsAndGroups();
  if (!candidates.length) {
    return ctx.reply(
      '❌ I could not discover any admin channels/groups yet.\\n\\n' +
      'Use /addchannel @channelusername (or its -100... ID) once, then run /channels.'
    );
  }

  const lines = candidates.map((x, i) =>
    `${i + 1}. ${escapeHtml(x.title)} ${x.username ? '@' + escapeHtml(x.username) : ''} ` +
    `${x.selected ? '✅ selected' : '☐ not selected'}`
  );

  await ctx.reply(
    '<b>📡 XRYON CHANNEL SYNC</b>\\n\\n' + lines.join('\\n') +
    '\\n\\nUse /channels to change selection.',
    { parse_mode: 'HTML' }
  );
});

// ---------- Channel/group selector for owner broadcasts ----------
const broadcastSelectorKeyboard = async () => {
  const chats = await getAdminChannelsAndGroups();
  const rows = chats.map(chat => [
    Markup.button.callback(
      `${chat.selected ? '✅' : '☐'} ${chat.title}`,
      `bc_toggle:${chat.id}`
    )
  ]);
  rows.push([Markup.button.callback('🔄 Refresh', 'bc_refresh')]);
  rows.push([Markup.button.callback('✅ Done', 'bc_done')]);
  return Markup.inlineKeyboard(rows);
};

async function showBroadcastSelector(ctx, edit = false) {
  const chats = await getAdminChannelsAndGroups();
  const selected = loadBroadcastTargets();
  const selectedIds = new Set(selected.map(x => String(x.id)));

  const lines = [
    '<b>📡 Broadcast destinations</b>',
    '',
    'Select channels/groups where the bot is an admin.',
    'New admin channels are detected automatically. Use /addchannel if needed.',
    'Only selected destinations receive /send and /sendimage.',
    '',
    `Selected: <b>${selected.length}</b>`
  ];

  if (selected.length) {
    lines.push('', ...selected.map((x, i) => `${i + 1}. ${escapeHtml(x.title)} <code>${escapeHtml(x.id)}</code>`));
  }

  const keyboard = await broadcastSelectorKeyboard();
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', ...keyboard });
  }
}

bot.command('channels', async (ctx) => {
  if (!isOwner(ctx)) return;
  await showBroadcastSelector(ctx);
});

bot.command('selectchannels', async (ctx) => {
  if (!isOwner(ctx)) return;
  await showBroadcastSelector(ctx);
});

bot.action('bc_refresh', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery('Refreshing...');
  await showBroadcastSelector(ctx, true);
});

bot.action(/^bc_toggle:(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();

  const chatId = ctx.match[1];
  const list = loadBroadcastTargets();
  const existing = list.find(x => String(x.id) === String(chatId));

  if (existing) {
    removeBroadcastTarget(chatId);
    await ctx.answerCbQuery('Removed from broadcast list');
  } else {
    try {
      const chat = await ctx.telegram.getChat(chatId);
      const me = await ctx.telegram.getMe();
      const member = await ctx.telegram.getChatMember(chat.id, me.id);
      const isAdmin = member.status === 'administrator' || member.status === 'creator';

      if (!isAdmin) {
        return ctx.answerCbQuery('Bot is not an admin there', { show_alert: true });
      }

      addBroadcastTarget(chat);
      await ctx.answerCbQuery('Added to broadcast list');
    } catch (e) {
      return ctx.answerCbQuery(`Cannot access chat: ${e.message}`.slice(0, 190), { show_alert: true });
    }
  }

  await showBroadcastSelector(ctx, true);
});

bot.action('bc_done', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const count = loadBroadcastTargets().length;
  await ctx.answerCbQuery(`Saved ${count} destination${count === 1 ? '' : 's'}`);
  await showBroadcastSelector(ctx, true);
});

// ---------- Broadcast selector feature menu ----------
bot.action('adm_broadcast_channels', async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  await showBroadcastSelector(ctx);
});

// ---------- Real owner-only commands (still work when typed; just not listed in the menu) ----------

bot.command('send', async (ctx) => {
  if (!isOwner(ctx)) return;
  const text = ctx.message.text.replace(/^\/send\s+/, '').trim();
  if (!text) return ctx.reply('Usage: /send <message>');

  const targets = selectedTargetIds();
  if (!targets.length) {
    return ctx.reply(
      '❌ No destinations are selected.\n\n' +
      'Use /channels → select your channel(s) → ✅ Done → then run /send again.'
    );
  }

  const result = await broadcast({ text, targets });

  let reply = `📨 <b>XRYON BROADCAST</b>\n\n` +
    `📡 Targets: ${result.targets.length}\n` +
    `✅ Sent: ${result.sent}\n` +
    `❌ Failed: ${result.failed}`;

  if (result.failures.length) {
    reply += '\n\n<b>Failures</b>\n' + result.failures.slice(0, 10).map(escapeHtml).join('\n');
  }

  await ctx.reply(reply, { parse_mode: 'HTML' });
});

bot.command('status', async (ctx) => {
  if (!isOwner(ctx)) return;
  const lines = [];
  for (const chat of config.TARGET_CHATS) {
    const ok = await isBotAdmin(chat);
    lines.push(`${chat}: ${ok ? 'admin ✅' : 'not admin ❌'}`);
  }
  await ctx.reply(lines.join('\n'));
});

bot.command('schedule', async (ctx) => {
  if (!isOwner(ctx)) return;
  // Usage: /schedule HH:MM your message here   (reply to a photo to attach an image)
  const match = ctx.message.text.match(/^\/schedule\s+(\d{1,2}:\d{2})\s+([\s\S]+)$/);
  if (!match) {
    return ctx.reply('Usage: /schedule HH:MM <message>  (24h time, e.g. /schedule 14:30 Hello!)\nReply to a photo to attach an image.');
  }
  const [, time, text] = match;
  const [h, m] = time.split(':').map(Number);
  if (h > 23 || m > 59) return ctx.reply('Invalid time. Use 24h HH:MM.');

  let imagePath = null;
  const reply = ctx.message.reply_to_message;
  if (reply && reply.photo) {
    const fileId = reply.photo[reply.photo.length - 1].file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(link.href);
    const buffer = Buffer.from(await res.arrayBuffer());
    imagePath = path.join(__dirname, 'scheduled_images', `${Date.now()}.jpg`);
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, buffer);
  }

  const entry = { id: Date.now().toString(36), time, text, imagePath };
  const list = loadSchedules();
  list.push(entry);
  saveSchedules(list);
  registerJob(entry);

  await ctx.reply(`Scheduled daily at ${time} (id: ${entry.id})${imagePath ? ' with image' : ''}.`);
});

bot.command('schedules', async (ctx) => {
  if (!isOwner(ctx)) return;
  const list = loadSchedules();
  if (!list.length) return ctx.reply(themed('warning', 'No custom schedules set.'));
  const lines = list.map((e) => `${e.id} — ${e.time} — ${e.text}${e.imagePath ? ' 📷' : ''}`);
  await ctx.reply(lines.join('\n'));
});

bot.command('unschedule', async (ctx) => {
  if (!isOwner(ctx)) return;
  const id = ctx.message.text.replace(/^\/unschedule\s+/, '').trim();
  if (!id) return ctx.reply('Usage: /unschedule <id>  (see /schedules for ids)');
  const list = loadSchedules();
  const entry = list.find((e) => e.id === id);
  if (!entry) return ctx.reply('No schedule with that id.');
  const task = jobs.get(id);
  if (task) {
    task.stop();
    jobs.delete(id);
  }
  saveSchedules(list.filter((e) => e.id !== id));
  await ctx.reply(`Removed schedule ${id}.`);
});

// ---------- Owner color-system command ----------
bot.command('colors', async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply(colorHelpText(), { parse_mode: 'HTML' });
});

// ---------- Fixed-config scheduling ----------

function setupSchedules() {
  // Owner-selected recurring broadcast test loop: every 5 seconds.
  // Only selected destinations receive the broadcast.
  setInterval(async () => {
    try {
      const targets = selectedTargetIds();
      if (!targets.length) return;
      const image = getSavedAutoBroadcastImage();
      const result = await broadcast({
        text: config.RECURRING_TEXT,
        imagePath: image,
        targets
      });
      if (result.sent || result.failed) {
        console.log(`⏱️ Recurring 5s broadcast: ✅ ${result.sent} / ❌ ${result.failed}`);
      }
    } catch (err) {
      console.error(`❌ 5-second recurring broadcast failed: ${err.message}`);
    }
  }, 5000);

  // Fixed clock-time posts, e.g. config.DAILY_TIMES = ["09:00", "18:30"]
  for (const t of config.DAILY_TIMES) {
    const [hour, minute] = t.split(':').map(Number);
    cron.schedule(`${minute} ${hour} * * *`, () => {
      broadcast({
        text: config.DAILY_TEXT,
        imagePath: config.DAILY_IMAGE_PATH,
        targets: selectedTargetIds()
      }).catch((err) => console.error(`❌ Daily broadcast failed: ${err.message}`));
    });
  }
}

// ---------- Command menu registration ----------
// Only the harmless/public commands are registered in Telegram's own menu, for everyone,
// including the owner. /admin and the real admin commands stay unlisted — they still work
// when typed, but nobody sees them offered anywhere in the UI.

async function setupCommandMenus() {
  await bot.telegram.setMyCommands(
    [
      { command: 'start', description: 'Open Xryon' },
      { command: 'help', description: 'Get help' },
      { command: 'about', description: 'About Xryon' },
      { command: 'profile', description: 'View your profile' },
    ],
    { scope: { type: 'default' } }
  );
}

/* ============================================================
   V3 TELEGRAM IMAGE AUTO-BROADCAST
   Owner-controlled scheduled image delivery to tracked groups.
   Telegram Bot API does not provide a list-all-groups endpoint, so
   groups are tracked whenever the bot receives a group message.
   ============================================================ */
const IMAGE_AUTO_BROADCAST = {
  dataDir: path.join(__dirname, 'data'),
  filePath: path.join(__dirname, 'data', 'auto-broadcast-image.json'),
  mediaDir: path.join(__dirname, 'data', 'media'),
  state: { enabled: false, intervalMs: 30 * 60 * 1000, caption: '', groupChats: [] },
  timer: null
};

function ensureImageAutoBroadcastStorage() {
  fs.mkdirSync(IMAGE_AUTO_BROADCAST.dataDir, { recursive: true });
  fs.mkdirSync(IMAGE_AUTO_BROADCAST.mediaDir, { recursive: true });
  try {
    if (fs.existsSync(IMAGE_AUTO_BROADCAST.filePath)) {
      const saved = JSON.parse(fs.readFileSync(IMAGE_AUTO_BROADCAST.filePath, 'utf8'));
      IMAGE_AUTO_BROADCAST.state = { ...IMAGE_AUTO_BROADCAST.state, ...saved };
    }
  } catch (_) {}
}
function saveImageAutoBroadcastState() {
  ensureImageAutoBroadcastStorage();
  fs.writeFileSync(IMAGE_AUTO_BROADCAST.filePath, JSON.stringify(IMAGE_AUTO_BROADCAST.state, null, 2));
}
function getSavedAutoBroadcastImage() {
  if (IMAGE_AUTO_BROADCAST.state.fileId) return IMAGE_AUTO_BROADCAST.state.fileId;
  const p = IMAGE_AUTO_BROADCAST.state.imagePath;
  return p && fs.existsSync(p) ? p : null;
}
function parseBroadcastInterval(value) {
  const m = String(value || '').trim().match(/^(\d+)\s*(s|m|h)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return n > 0 ? n * (unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000) : null;
}
function formatBroadcastInterval(ms) {
  if (ms % 3600000 === 0) return `${ms / 3600000}h`;
  if (ms % 60000 === 0) return `${ms / 60000}m`;
  return `${Math.round(ms / 1000)}s`;
}
async function sendPhotoWithRetry(chatId, imageSource, caption = '', maxAttempts = 3) {
  if (!imageSource) return { ok: false, error: 'No image source is configured.' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let source = imageSource;
      if (typeof imageSource === 'string' && (imageSource.startsWith('/') || imageSource.includes('data/media/') || imageSource.includes('scheduled_images/'))) {
        if (!fs.existsSync(imageSource)) throw new Error(`Local image file missing: ${imageSource}`);
        source = { source: fs.createReadStream(imageSource), filename: path.basename(imageSource) };
      }
      await bot.telegram.sendPhoto(chatId, source, { caption: caption || undefined });
      return { ok: true };
    } catch (e) {
      console.error(`sendPhoto attempt ${attempt}/${maxAttempts} failed for ${chatId}: ${e.message}`);
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 3000 * attempt));
      if (String(e.message).includes('400') || String(e.message).toLowerCase().includes('file is too big')) break;
    }
  }
  return { ok: false, error: 'Photo upload/send failed after retries.' };
}

async function sendSavedImageToGroups(targets = null) {
  const imagePath = getSavedAutoBroadcastImage();
  if (!imagePath) return { sent: 0, failed: 0, reason: 'no-image', failures: [] };

  const groups = [...new Set((targets || selectedTargetIds()).map(String))];
  if (!groups.length) return { sent: 0, failed: 0, reason: 'no-targets', failures: [] };

  let sent = 0, failed = 0;
  const failures = [];

  for (const chatId of groups) {
    const admin = await isBotAdmin(chatId);
    if (!admin) {
      failed++;
      failures.push(`${chatId}: bot is not admin or chat is inaccessible`);
      continue;
    }

    const result = await sendPhotoWithRetry(
      chatId,
      imagePath,
      IMAGE_AUTO_BROADCAST.state.caption || ''
    );

    if (result.ok) {
      sent++;
    } else {
      failed++;
      failures.push(`${chatId}: ${result.error}`);
    }

    await new Promise(resolve => setTimeout(resolve, 2500));
  }

  return { sent, failed, failures, targets: groups };
}
function stopImageAutoBroadcast() {
  if (IMAGE_AUTO_BROADCAST.timer) clearInterval(IMAGE_AUTO_BROADCAST.timer);
  IMAGE_AUTO_BROADCAST.timer = null;
  IMAGE_AUTO_BROADCAST.state.enabled = false;
  saveImageAutoBroadcastState();
}
function startImageAutoBroadcast() {
  stopImageAutoBroadcast();
  if (!getSavedAutoBroadcastImage()) return false;
  IMAGE_AUTO_BROADCAST.state.enabled = true;
  saveImageAutoBroadcastState();
  sendSavedImageToGroups().catch(console.error);
  IMAGE_AUTO_BROADCAST.timer = setInterval(() => sendSavedImageToGroups().catch(console.error), IMAGE_AUTO_BROADCAST.state.intervalMs);
  return true;
}
ensureImageAutoBroadcastStorage();

bot.use(async (ctx, next) => {
  try {
    const type = ctx.chat?.type;
    if ((type === 'group' || type === 'supergroup') && ctx.chat?.id) {
      const groups = new Set(IMAGE_AUTO_BROADCAST.state.groupChats || []);
      groups.add(String(ctx.chat.id));
      IMAGE_AUTO_BROADCAST.state.groupChats = [...groups];
      saveImageAutoBroadcastState();
    }
  } catch (_) {}
  return next();
});

bot.command('sendtest', async (ctx) => {
  if (!isOwner(ctx)) return;
  const targets = selectedTargetIds();
  if (!targets.length) return ctx.reply('❌ No destinations selected. Use /channels first.');
  const image = getSavedAutoBroadcastImage();
  const result = await broadcast({
    text: config.RECURRING_TEXT,
    imagePath: image,
    targets
  });
  let msg = `<b>🧪 XRYON TEST BROADCAST</b>\n\n📡 Targets: ${result.targets.length}\n✅ Sent: ${result.sent}\n❌ Failed: ${result.failed}`;
  if (result.failures?.length) msg += '\n\n<b>Failures</b>\n' + result.failures.slice(0, 10).map(escapeHtml).join('\n');
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('autostatus', async (ctx) => {
  if (!isOwner(ctx)) return;
  const img = getSavedAutoBroadcastImage();
  await ctx.reply(`🖼️ Image auto-broadcast\nImage: ${img ? 'saved' : 'not set'}\nSelected destinations: ${loadBroadcastTargets().length}\nTracked groups: ${(IMAGE_AUTO_BROADCAST.state.groupChats || []).length}\nStatus: ${IMAGE_AUTO_BROADCAST.state.enabled ? 'ON' : 'OFF'}\nInterval: ${formatBroadcastInterval(IMAGE_AUTO_BROADCAST.state.intervalMs)}\nUse /channels to choose destinations.`);
});
bot.command('sendimage', async (ctx) => {
  if (!isOwner(ctx)) return;

  const targets = selectedTargetIds();
  if (!targets.length) {
    return ctx.reply(
      '❌ No broadcast destinations are selected.\n\n' +
      'Use /channels, select your channels/groups, then press ✅ Done.'
    );
  }

  const result = await sendSavedImageToGroups(targets);

  if (result.reason === 'no-image') {
    return ctx.reply('❌ No image is saved. Send a photo to the bot first.');
  }

  let message =
    `<b>🖼️ XRYON IMAGE BROADCAST</b>\n\n` +
    `📡 Targets: ${result.targets?.length || targets.length}\n` +
    `✅ Sent: ${result.sent}\n` +
    `❌ Failed: ${result.failed}`;

  if (result.failures?.length) {
    message += '\n\n<b>Failures</b>\n' + result.failures.slice(0, 10).map(escapeHtml).join('\n');
  }

  await ctx.reply(message, { parse_mode: 'HTML' });
});
bot.command('autosend', async (ctx) => {
  if (!isOwner(ctx)) return;
  const text = ctx.message.text.trim();
  if (/^\/autosend\s+off$/i.test(text)) {
    stopImageAutoBroadcast();
    return ctx.reply('🛑 Image auto-broadcast stopped.');
  }
  const match = text.match(/^\/autosend\s+on(?:\s+(\d+\s*[smh]))?$/i);
  if (!match) return ctx.reply('Usage: /autosend on 1h  |  /autosend off');
  if (match[1]) IMAGE_AUTO_BROADCAST.state.intervalMs = parseBroadcastInterval(match[1]) || IMAGE_AUTO_BROADCAST.state.intervalMs;
  const ok = startImageAutoBroadcast();
  await ctx.reply(ok ? `✅ Image auto-broadcast enabled every ${formatBroadcastInterval(IMAGE_AUTO_BROADCAST.state.intervalMs)}.` : '❌ Save an image first by sending a photo to the bot.');
});
bot.command('autointerval', async (ctx) => {
  if (!isOwner(ctx)) return;
  const match = ctx.message.text.match(/^\/autointerval\s+(\d+\s*[smh])$/i);
  const parsed = match && parseBroadcastInterval(match[1]);
  if (!parsed) return ctx.reply('❌ Use a value such as 30s, 10m, or 1h.');
  IMAGE_AUTO_BROADCAST.state.intervalMs = parsed;
  saveImageAutoBroadcastState();
  if (IMAGE_AUTO_BROADCAST.state.enabled) startImageAutoBroadcast();
  await ctx.reply(`✅ Interval set to ${formatBroadcastInterval(parsed)}.`);
});
bot.command('autocaption', async (ctx) => {
  if (!isOwner(ctx)) return;
  IMAGE_AUTO_BROADCAST.state.caption = ctx.message.text.replace(/^\/autocaption\s*/i, '');
  saveImageAutoBroadcastState();
  await ctx.reply('✅ Auto-broadcast caption updated.');
});
bot.on('photo', async (ctx) => {
  if (!isOwner(ctx)) return;
  try {
    ensureImageAutoBroadcastStorage();
    const largest = ctx.message.photo[ctx.message.photo.length - 1];
    const link = await ctx.telegram.getFileLink(largest.file_id);
    const res = await fetch(link.href);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const filePath = path.join(IMAGE_AUTO_BROADCAST.mediaDir, `${Date.now()}.jpg`);
    fs.writeFileSync(filePath, buffer);
    IMAGE_AUTO_BROADCAST.state.imagePath = filePath;
    IMAGE_AUTO_BROADCAST.state.savedAt = new Date().toISOString();
    saveImageAutoBroadcastState();
    await ctx.reply('✅ Image saved. Xryon will use this image for the recurring broadcast and /sendimage.');
  } catch (e) {
    console.error('Could not save broadcast image:', e);
    await ctx.reply('❌ Could not save the image.');
  }
});



// ---------- Automatic bot profile picture on deploy ----------
async function updateProfilePictureOnDeploy() {
  const enabled = config.UPDATE_PIC_ON_DEPLOY !== false;
  const imageUrl = config.PROFILE_PIC_URL;
  if (!enabled || !imageUrl) {
    console.log('ℹ️ Automatic profile picture update is disabled or PROFILE_PIC_URL is missing.');
    return;
  }

  try {
    console.log(`🖼️ Downloading bot profile picture: ${imageUrl}`);

    const imageResponse = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 TelegramBot/1.0' },
      redirect: 'follow'
    });

    if (!imageResponse.ok) {
      throw new Error(`Image download failed: HTTP ${imageResponse.status} ${imageResponse.statusText}`);
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!imageBuffer.length) throw new Error('Downloaded profile picture is empty.');

    // Telegram requires a freshly uploaded JPG for setMyProfilePhoto.
    // The URL is downloaded first; the bytes are then uploaded as a new file.
    const form = new FormData();
    form.append(
      'photo',
      JSON.stringify({
        type: 'static',
        photo: 'attach://profile_photo'
      })
    );
    form.append(
      'profile_photo',
      new Blob([imageBuffer], { type: 'image/jpeg' }),
      'profile.jpg'
    );

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${config.BOT_TOKEN}/setMyProfilePhoto`,
      {
        method: 'POST',
        body: form
      }
    );

    const raw = await telegramResponse.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error(`Telegram returned non-JSON response (HTTP ${telegramResponse.status}): ${raw.slice(0, 500)}`);
    }

    if (!telegramResponse.ok || !result.ok) {
      throw new Error(
        `Telegram setMyProfilePhoto failed (HTTP ${telegramResponse.status}): ${result.description || raw}`
      );
    }

    console.log('✅ Bot profile picture updated successfully on startup/deploy.');
  } catch (error) {
    console.error(`❌ Profile picture update failed: ${error.stack || error.message || error}`);
  }
}

async function main() {
  const botInfo = await loadBotInfo();
  if (botInfo && config.SHOW_BOT_INFO_ON_DEPLOY !== false) {
    console.log('');
    console.log('🤖 XRYON / Bot identity');
    console.log(`   Name: ${[botInfo.first_name, botInfo.last_name].filter(Boolean).join(' ') || 'Unnamed'}`);
    console.log(`   Username: ${botInfo.username ? '@' + botInfo.username : '(no username set)'}`);
    console.log(`   ID: ${botInfo.id}`);
    console.log('');
  }
  setupSchedules();
  loadCustomSchedules();
  await setupCommandMenus();

  // Do this before starting polling so deployment logs clearly show whether
  // Telegram accepted the new profile photo.
  await updateProfilePictureOnDeploy();

  await bot.launch();
  console.log('Bot started.');
}

main();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
