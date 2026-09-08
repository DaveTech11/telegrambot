
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const config = require('./config');

const bot = new Telegraf(config.BOT_TOKEN);

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

async function broadcast({ text, imagePath, targets } = {}) {
  const chats = targets || config.TARGET_CHATS;
  for (const chat of chats) {
    const admin = await isBotAdmin(chat);
    if (!admin) {
      console.log(`Skipping ${chat} - bot is not admin there.`);
      continue;
    }
    try {
      if (imagePath && fs.existsSync(imagePath)) {
        await bot.telegram.sendPhoto(chat, { source: imagePath }, { caption: text || '' });
      } else if (text) {
        await bot.telegram.sendMessage(chat, text);
      }
    } catch (e) {
      console.error(`Failed to send to ${chat}: ${e.message}`);
    }
  }
}

function isOwner(ctx) {
  return !!ctx.from && config.OWNER_IDS.includes(ctx.from.id);
}

// ---------- Public (decoy) menu shown to every user ----------
// These are the ONLY commands registered in Telegram's own "/" menu (setMyCommands),
// so regular users never see the admin commands listed there at all.

const publicKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('ℹ️ Help', 'pub_help')],
  [Markup.button.callback('📖 About', 'pub_about')],
]);

bot.start(async (ctx) => {
  await ctx.reply(
    `${themed('primary', 'Welcome', { heading: true })}\n\n👋 Hi! I share periodic updates in this channel/group.\nUse the buttons below to learn more.`,
    { ...publicKeyboard, parse_mode: 'HTML' }
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(themed('info', 'This bot posts scheduled updates. Nothing to configure here — just sit back.'));
});

bot.command('about', async (ctx) => {
  await ctx.reply(`${themed('accent', 'About', { heading: true })}\n\n🤖 An automated update bot.`, { parse_mode: 'HTML' });
});

bot.action('pub_help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(themed('info', 'This bot posts scheduled updates. Nothing to configure here — just sit back.'));
});

bot.action('pub_about', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`${themed('accent', 'About', { heading: true })}\n\n🤖 An automated update bot.`, { parse_mode: 'HTML' });
});

// ---------- Hidden admin panel — unlocked only via /admin, only for OWNER_IDS ----------
// /admin itself is never listed in the bot's command menu for anyone, and does nothing
// visible when a non-owner sends it (no reply, no error) — it just looks like an unknown command.

const adminKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📊 Status', 'adm_status')],
  [Markup.button.callback('📋 List Schedules', 'adm_schedules')],
  [Markup.button.callback('📨 Send now (how)', 'adm_send_help')],
  [Markup.button.callback('🖼 Set picture (how)', 'adm_setpic_help')],
  [Markup.button.callback('⏰ Schedule a post (how)', 'adm_schedule_help')],
  [Markup.button.callback('🗑 Remove a schedule (how)', 'adm_unschedule_help')],
]);

bot.command('admin', async (ctx) => {
  if (!isOwner(ctx)) return; // silent — looks like the command doesn't exist
  await ctx.reply(`${themed('success', 'Admin panel unlocked.', { heading: true })}`, { parse_mode: 'HTML', ...adminKeyboard });
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
  await ctx.reply('Type: /send <message>\nBroadcasts it immediately to every admin chat.');
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

// ---------- Real owner-only commands (still work when typed; just not listed in the menu) ----------

bot.command('send', async (ctx) => {
  if (!isOwner(ctx)) return;
  const text = ctx.message.text.replace(/^\/send\s+/, '');
  if (!text) return ctx.reply('Usage: /send <message>');
  await broadcast({ text });
  await ctx.reply('Sent to all admin chats.');
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
  // Recurring post every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    broadcast({ text: config.RECURRING_TEXT, imagePath: config.RECURRING_IMAGE_PATH });
  });

  // Fixed clock-time posts, e.g. config.DAILY_TIMES = ["09:00", "18:30"]
  for (const t of config.DAILY_TIMES) {
    const [hour, minute] = t.split(':').map(Number);
    cron.schedule(`${minute} ${hour} * * *`, () => {
      broadcast({ text: config.DAILY_TEXT, imagePath: config.DAILY_IMAGE_PATH });
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
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'How this bot works' },
      { command: 'about', description: 'About this bot' },
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
async function sendSavedImageToGroups() {
  const imagePath = getSavedAutoBroadcastImage();
  if (!imagePath) return { sent: 0, failed: 0, reason: 'no-image' };
  const groups = [...new Set(IMAGE_AUTO_BROADCAST.state.groupChats || [])];
  let sent = 0, failed = 0;
  for (const chatId of groups) {
    try {
      await bot.telegram.sendPhoto(chatId, { source: imagePath }, {
        caption: IMAGE_AUTO_BROADCAST.state.caption || undefined
      });
      sent++;
    } catch (e) {
      failed++;
      console.error(`Image broadcast failed for ${chatId}: ${e.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return { sent, failed };
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

bot.command('autostatus', async (ctx) => {
  if (!isOwner(ctx)) return;
  const img = getSavedAutoBroadcastImage();
  await ctx.reply(`🖼️ Image auto-broadcast\nImage: ${img ? 'saved' : 'not set'}\nGroups tracked: ${(IMAGE_AUTO_BROADCAST.state.groupChats || []).length}\nStatus: ${IMAGE_AUTO_BROADCAST.state.enabled ? 'ON' : 'OFF'}\nInterval: ${formatBroadcastInterval(IMAGE_AUTO_BROADCAST.state.intervalMs)}`);
});
bot.command('sendimage', async (ctx) => {
  if (!isOwner(ctx)) return;
  const result = await sendSavedImageToGroups();
  await ctx.reply(result.reason === 'no-image' ? '❌ No image is saved. Send a photo to the bot first.' : `🖼️ Broadcast complete\n✅ Sent: ${result.sent}\n❌ Failed: ${result.failed}`);
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
    await ctx.reply('✅ Image saved. Use /sendimage for a one-time broadcast or /autosend on 1h for scheduled sending.');
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


