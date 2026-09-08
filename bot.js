
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const config = require('./config');

const bot = new Telegraf(config.BOT_TOKEN);

// ---------- Color system ----------

const COLOR_THEMES = {
  blue: {
    primary: '🔵',
    success: '🟢',
    warning: '🟡',
    danger: '🔴',
    info: '🔷',
    accent: '🔹'
  },
  green: {
    primary: '🟢',
    success: '✅',
    warning: '🟡',
    danger: '🔴',
    info: '🟩',
    accent: '🌿'
  },
  red: {
    primary: '🔴',
    success: '🟢',
    warning: '🟠',
    danger: '⛔',
    info: '🔺',
    accent: '♦️'
  },
  purple: {
    primary: '🟣',
    success: '🟢',
    warning: '🟡',
    danger: '🔴',
    info: '🟪',
    accent: '💜'
  },
  gold: {
    primary: '🟡',
    success: '🟢',
    warning: '🟠',
    danger: '🔴',
    info: '⭐',
    accent: '✨'
  },
  monochrome: {
    primary: '⚪',
    success: '✅',
    warning: '⚠️',
    danger: '❌',
    info: '◻️',
    accent: '▪️'
  }
};

function getColors() {
  const settings = config.COLOR_SYSTEM || {};
  return COLOR_THEMES[settings.theme] || COLOR_THEMES.blue;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function themed(kind, text, options = {}) {
  const settings = config.COLOR_SYSTEM || {};

  if (!settings.enabled) {
    return escapeHtml(text);
  }

  const colors = getColors();
  const icon = colors[kind] || colors.primary;

  const body =
    settings.boldHeadings && options.heading
      ? `<b>${escapeHtml(text)}</b>`
      : escapeHtml(text);

  return settings.prefix === false ? body : `${icon} ${body}`;
}

function colorThemeName() {
  return (config.COLOR_SYSTEM && config.COLOR_SYSTEM.theme) || 'blue';
}

function colorHelpText() {
  return [
    `<b>🎨 Color System</b>`,
    ``,
    `Theme: <code>${escapeHtml(colorThemeName())}</code>`,
    `Status: ${
      config.COLOR_SYSTEM && config.COLOR_SYSTEM.enabled
        ? '🟢 enabled'
        : '🔴 disabled'
    }`,
    ``,
    `<b>Available themes</b>`,
    `🔵 blue • 🟢 green • 🔴 red`,
    `🟣 purple • 🟡 gold • ⚪ monochrome`,
    ``,
    `Change the default theme in <code>config.js</code>.`
  ].join('\n');
}

// ---------- Custom schedules ----------

const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');
const jobs = new Map();

function loadSchedules() {
  if (!fs.existsSync(SCHEDULES_FILE)) return [];

  try {
    return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSchedules(list) {
  fs.writeFileSync(
    SCHEDULES_FILE,
    JSON.stringify(list, null, 2)
  );
}

function registerJob(entry) {
  const [hour, minute] = entry.time.split(':').map(Number);

  const task = cron.schedule(
    `${minute} ${hour} * * *`,
    () => {
      broadcast({
        text: entry.text,
        imagePath: entry.imagePath || null
      });
    }
  );

  jobs.set(entry.id, task);
}

function loadCustomSchedules() {
  for (const entry of loadSchedules()) {
    registerJob(entry);
  }
}

// ---------- Telegram Bot API ----------

async function isBotAdmin(chatId) {
  try {
    const me = await bot.telegram.getMe();

    const member = await bot.telegram.getChatMember(
      chatId,
      me.id
    );

    return (
      member.status === 'administrator' ||
      member.status === 'creator'
    );
  } catch (e) {
    console.warn(
      `Admin check failed for ${chatId}: ${e.message}`
    );

    return false;
  }
}

async function broadcast({ text, imagePath, targets } = {}) {
  const chats = targets || config.TARGET_CHATS;

  for (const chat of chats) {
    const admin = await isBotAdmin(chat);

    if (!admin) {
      console.log(
        `Skipping ${chat} - bot is not admin there.`
      );
      continue;
    }

    try {
      if (imagePath && fs.existsSync(imagePath)) {
        await bot.telegram.sendPhoto(
          chat,
          { source: imagePath },
          { caption: text || '' }
        );
      } else if (text) {
        await bot.telegram.sendMessage(chat, text);
      }
    } catch (e) {
      console.error(
        `Failed to send to ${chat}: ${e.message}`
      );
    }
  }
}

function isOwner(ctx) {
  return (
    !!ctx.from &&
    config.OWNER_IDS.includes(ctx.from.id)
  );
}

// ---------- Public menu ----------

const publicKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback(
      'ℹ️ Help',
      'pub_help'
    )
  ],
  [
    Markup.button.callback(
      '📖 About',
      'pub_about'
    )
  ]
]);

bot.start(async (ctx) => {
  await ctx.reply(
    `${themed(
      'primary',
      'Welcome',
      { heading: true }
    )}\n\n👋 Hi! I share periodic updates in this channel/group.\nUse the buttons below to learn more.`,
    {
      ...publicKeyboard,
      parse_mode: 'HTML'
    }
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    themed(
      'info',
      'This bot posts scheduled updates. Nothing to configure here — just sit back.'
    )
  );
});

bot.command('about', async (ctx) => {
  await ctx.reply(
    `${themed(
      'accent',
      'About',
      { heading: true }
    )}\n\n🤖 An automated update bot.`,
    {
      parse_mode: 'HTML'
    }
  );
});

bot.action('pub_help', async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.reply(
    themed(
      'info',
      'This bot posts scheduled updates. Nothing to configure here — just sit back.'
    )
  );
});

bot.action('pub_about', async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.reply(
    `${themed(
      'accent',
      'About',
      { heading: true }
    )}\n\n🤖 An automated update bot.`,
    {
      parse_mode: 'HTML'
    }
  );
});

// ---------- Owner admin panel ----------

const adminKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback(
      '📊 Status',
      'adm_status'
    )
  ],
  [
    Markup.button.callback(
      '📋 List Schedules',
      'adm_schedules'
    )
  ],
  [
    Markup.button.callback(
      '📨 Send now',
      'adm_send_help'
    )
  ],
  [
    Markup.button.callback(
      '⏰ Schedule a post',
      'adm_schedule_help'
    )
  ],
  [
    Markup.button.callback(
      '🗑 Remove a schedule',
      'adm_unschedule_help'
    )
  ]
]);

bot.command('admin', async (ctx) => {
  if (!isOwner(ctx)) return;

  await ctx.reply(
    themed(
      'success',
      'Admin panel unlocked.',
      { heading: true }
    ),
    {
      parse_mode: 'HTML',
      ...adminKeyboard
    }
  );
});

bot.action('adm_status', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.answerCbQuery();
  }

  await ctx.answerCbQuery();

  const lines = [];

  for (const chat of config.TARGET_CHATS) {
    const ok = await isBotAdmin(chat);

    lines.push(
      `${chat}: ${
        ok
          ? `${getColors().success} admin`
          : '❌ not admin'
      }`
    );
  }

  await ctx.reply(
    lines.length
      ? lines.join('\n')
      : themed(
          'warning',
          'No target chats configured.'
        )
  );
});

bot.action('adm_schedules', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.answerCbQuery();
  }

  await ctx.answerCbQuery();

  const list = loadSchedules();

  if (!list.length) {
    return ctx.reply(
      themed(
        'warning',
        'No custom schedules set.'
      )
    );
  }

  const lines = list.map(
    (e) =>
      `${e.id} — ${e.time} — ${e.text}${
        e.imagePath ? ' 📷' : ''
      }`
  );

  await ctx.reply(lines.join('\n'));
});

bot.action('adm_send_help', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.answerCbQuery();
  }

  await ctx.answerCbQuery();

  await ctx.reply(
    'Type: /send <message>\nBroadcasts it immediately to every configured target chat.'
  );
});

bot.action('adm_schedule_help', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.answerCbQuery();
  }

  await ctx.answerCbQuery();

  await ctx.reply(
    'Type: /schedule HH:MM <message>\nExample: /schedule 14:30 Good afternoon!'
  );
});

bot.action('adm_unschedule_help', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.answerCbQuery();
  }

  await ctx.answerCbQuery();

  await ctx.reply(
    'Type: /unschedule <id>\nGet IDs from /schedules.'
  );
});

// ---------- Owner commands ----------

bot.command('send', async (ctx) => {
  if (!isOwner(ctx)) return;

  const text = ctx.message.text.replace(
    /^\/send\s+/,
    ''
  );

  if (!text) {
    return ctx.reply(
      'Usage: /send <message>'
    );
  }

  await broadcast({ text });

  await ctx.reply(
    '✅ Sent to configured target chats.'
  );
});

bot.command('status', async (ctx) => {
  if (!isOwner(ctx)) return;

  const lines = [];

  for (const chat of config.TARGET_CHATS) {
    const ok = await isBotAdmin(chat);

    lines.push(
      `${chat}: ${
        ok ? 'admin ✅' : 'not admin ❌'
      }`
    );
  }

  await ctx.reply(lines.join('\n'));
});

bot.command('schedule', async (ctx) => {
  if (!isOwner(ctx)) return;

  const match = ctx.message.text.match(
    /^\/schedule\s+(\d{1,2}:\d{2})\s+([\s\S]+)$/
  );

  if (!match) {
    return ctx.reply(
      'Usage: /schedule HH:MM <message>\nExample: /schedule 14:30 Hello!'
    );
  }

  const [, time, text] = match;

  const [h, m] = time
    .split(':')
    .map(Number);

  if (h > 23 || m > 59) {
    return ctx.reply(
      'Invalid time. Use 24h HH:MM.'
    );
  }

  const entry = {
    id: Date.now().toString(36),
    time,
    text,
    imagePath: null
  };

  const list = loadSchedules();

  list.push(entry);
  saveSchedules(list);

  registerJob(entry);

  await ctx.reply(
    `✅ Scheduled daily at ${time}\nID: ${entry.id}`
  );
});

bot.command('schedules', async (ctx) => {
  if (!isOwner(ctx)) return;

  const list = loadSchedules();

  if (!list.length) {
    return ctx.reply(
      themed(
        'warning',
        'No custom schedules set.'
      )
    );
  }

  const lines = list.map(
    (e) =>
      `${e.id} — ${e.time} — ${e.text}`
  );

  await ctx.reply(lines.join('\n'));
});

bot.command('unschedule', async (ctx) => {
  if (!isOwner(ctx)) return;

  const id = ctx.message.text
    .replace(/^\/unschedule\s+/, '')
    .trim();

  if (!id) {
    return ctx.reply(
      'Usage: /unschedule <id>'
    );
  }

  const list = loadSchedules();

  const entry = list.find(
    (e) => e.id === id
  );

  if (!entry) {
    return ctx.reply(
      'No schedule with that ID.'
    );
  }

  const task = jobs.get(id);

  if (task) {
    task.stop();
    jobs.delete(id);
  }

  saveSchedules(
    list.filter((e) => e.id !== id)
  );

  await ctx.reply(
    `✅ Removed schedule ${id}.`
  );
});

// ---------- Colors ----------

bot.command('colors', async (ctx) => {
  if (!isOwner(ctx)) return;

  await ctx.reply(
    colorHelpText(),
    {
      parse_mode: 'HTML'
    }
  );
});

// ---------- Fixed schedules ----------

function setupSchedules() {
  cron.schedule(
    '*/2 * * * *',
    () => {
      broadcast({
        text: config.RECURRING_TEXT,
        imagePath:
          config.RECURRING_IMAGE_PATH
      });
    }
  );

  for (const t of config.DAILY_TIMES) {
    const [hour, minute] = t
      .split(':')
      .map(Number);

    cron.schedule(
      `${minute} ${hour} * * *`,
      () => {
        broadcast({
          text: config.DAILY_TEXT,
          imagePath:
            config.DAILY_IMAGE_PATH
        });
      }
    );
  }
}

// ---------- Telegram command menu ----------

async function setupCommandMenus() {
  await bot.telegram.setMyCommands(
    [
      {
        command: 'start',
        description: 'Start the bot'
      },
      {
        command: 'help',
        description: 'How this bot works'
      },
      {
        command: 'about',
        description: 'About this bot'
      }
    ],
    {
      scope: {
        type: 'default'
      }
    }
  );
}

// ============================================================
// V3 IMAGE AUTO-BROADCAST
// ============================================================

const IMAGE_AUTO_BROADCAST = {
  dataDir: path.join(
    __dirname,
    'data'
  ),

  filePath: path.join(
    __dirname,
    'data',
    'auto-broadcast-image.json'
  ),

  mediaDir: path.join(
    __dirname,
    'data',
    'media'
  ),

  state: {
    enabled: false,
    intervalMs: 30 * 60 * 1000,
    caption: '',
    groupChats: []
  },

  timer: null
};

function ensureImageAutoBroadcastStorage() {
  fs.mkdirSync(
    IMAGE_AUTO_BROADCAST.dataDir,
    { recursive: true }
  );

  fs.mkdirSync(
    IMAGE_AUTO_BROADCAST.mediaDir,
    { recursive: true }
  );

  try {
    if (
      fs.existsSync(
        IMAGE_AUTO_BROADCAST.filePath
      )
    ) {
      const saved = JSON.parse(
        fs.readFileSync(
          IMAGE_AUTO_BROADCAST.filePath,
          'utf8'
        )
      );

      IMAGE_AUTO_BROADCAST.state = {
        ...IMAGE_AUTO_BROADCAST.state,
        ...saved
      };
    }
  } catch (_) {}
}

function saveImageAutoBroadcastState() {
  ensureImageAutoBroadcastStorage();

  fs.writeFileSync(
    IMAGE_AUTO_BROADCAST.filePath,
    JSON.stringify(
      IMAGE_AUTO_BROADCAST.state,
      null,
      2
    )
  );
}

function getSavedAutoBroadcastImage() {
  const p =
    IMAGE_AUTO_BROADCAST.state.imagePath;

  return p && fs.existsSync(p)
    ? p
    : null;
}

function parseBroadcastInterval(value) {
  const m = String(value || '')
    .trim()
    .match(/^(\d+)\s*(s|m|h)$/i);

  if (!m) return null;

  const n = Number(m[1]);
  const unit = m[2].toLowerCase();

  return n > 0
    ? n *
        (unit === 's'
          ? 1000
          : unit === 'm'
          ? 60000
          : 3600000)
    : null;
}

function formatBroadcastInterval(ms) {
  if (ms % 3600000 === 0) {
    return `${ms / 3600000}h`;
  }

  if (ms % 60000 === 0) {
    return `${ms / 60000}m`;
  }

  return `${Math.round(ms / 1000)}s`;
}

async function sendSavedImageToGroups() {
  const imagePath =
    getSavedAutoBroadcastImage();

  if (!imagePath) {
    return {
      sent: 0,
      failed: 0,
      reason: 'no-image'
    };
  }

  const groups = [
    ...new Set(
      IMAGE_AUTO_BROADCAST.state
        .groupChats || []
    )
  ];

  let sent = 0;
  let failed = 0;

  for (const chatId of groups) {
    try {
      await bot.telegram.sendPhoto(
        chatId,
        {
          source: imagePath
        },
        {
          caption:
            IMAGE_AUTO_BROADCAST.state
              .caption || undefined
        }
      );

      sent++;
    } catch (e) {
      failed++;

      console.error(
        `Image broadcast failed for ${chatId}: ${e.message}`
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 1500)
    );
  }

  return {
    sent,
    failed
  };
}

function stopImageAutoBroadcast() {
  if (
    IMAGE_AUTO_BROADCAST.timer
  ) {
    clearInterval(
      IMAGE_AUTO_BROADCAST.timer
    );
  }

  IMAGE_AUTO_BROADCAST.timer = null;
  IMAGE_AUTO_BROADCAST.state.enabled =
    false;

  saveImageAutoBroadcastState();
}

function startImageAutoBroadcast() {
  stopImageAutoBroadcast();

  if (!getSavedAutoBroadcastImage()) {
    return false;
  }

  IMAGE_AUTO_BROADCAST.state.enabled =
    true;

  saveImageAutoBroadcastState();

  sendSavedImageToGroups()
    .catch(console.error);

  IMAGE_AUTO_BROADCAST.timer =
    setInterval(
      () =>
        sendSavedImageToGroups()
          .catch(console.error),
      IMAGE_AUTO_BROADCAST.state
        .intervalMs
    );

  return true;
}

ensureImageAutoBroadcastStorage();

// Track groups the bot receives messages from.

bot.use(async (ctx, next) => {
  try {
    const type =
      ctx.chat?.type;

    if (
      (type === 'group' ||
        type === 'supergroup') &&
      ctx.chat?.id
    ) {
      const groups =
        new Set(
          IMAGE_AUTO_BROADCAST.state
            .groupChats || []
        );

      groups.add(
        String(ctx.chat.id)
      );

      IMAGE_AUTO_BROADCAST.state.groupChats =
        [...groups];

      saveImageAutoBroadcastState();
    }
  } catch (_) {}

  return next();
});

// ---------- Image automation commands ----------

bot.command('autostatus', async (ctx) => {
  if (!isOwner(ctx)) return;

  const img =
    getSavedAutoBroadcastImage();

  await ctx.reply(
    [
      '🖼️ Image auto-broadcast',
      `Image: ${
        img ? 'saved' : 'not set'
      }`,
      `Groups tracked: ${
        (
          IMAGE_AUTO_BROADCAST
            .state.groupChats || []
        ).length
      }`,
      `Status: ${
        IMAGE_AUTO_BROADCAST.state.enabled
          ? 'ON'
          : 'OFF'
      }`,
      `Interval: ${formatBroadcastInterval(
        IMAGE_AUTO_BROADCAST.state
          .intervalMs
      )}`
    ].join('\n')
  );
});

bot.command('sendimage', async (ctx) => {
  if (!isOwner(ctx)) return;

  const result =
    await sendSavedImageToGroups();

  if (result.reason === 'no-image') {
    return ctx.reply(
      '❌ No image is saved. Send a photo to the bot first.'
    );
  }

  await ctx.reply(
    [
      '🖼️ Broadcast complete',
      `✅ Sent: ${result.sent}`,
      `❌ Failed: ${result.failed}`
    ].join('\n')
  );
});

bot.command('autosend', async (ctx) => {
  if (!isOwner(ctx)) return;

  const text =
    ctx.message.text.trim();

  if (
    /^\/autosend\s+off$/i.test(text)
  ) {
    stopImageAutoBroadcast();

    return ctx.reply(
      '🛑 Image auto-broadcast stopped.'
    );
  }

  const match = text.match(
    /^\/autosend\s+on(?:\s+(\d+\s*[smh]))?$/i
  );

  if (!match) {
    return ctx.reply(
      'Usage: /autosend on 1h | /autosend off'
    );
  }

  if (match[1]) {
    IMAGE_AUTO_BROADCAST.state
      .intervalMs =
      parseBroadcastInterval(
        match[1]
      ) ||
      IMAGE_AUTO_BROADCAST.state
        .intervalMs;
  }

  const ok =
    startImageAutoBroadcast();

  await ctx.reply(
    ok
      ? `✅ Image auto-broadcast enabled every ${formatBroadcastInterval(
          IMAGE_AUTO_BROADCAST.state
            .intervalMs
        )}.`
      : '❌ Save an image first by sending a photo to the bot.'
  );
});

bot.command('autointerval', async (ctx) => {
  if (!isOwner(ctx)) return;

  const match =
    ctx.message.text.match(
      /^\/autointerval\s+(\d+\s*[smh])$/i
    );

  const parsed =
    match &&
    parseBroadcastInterval(
      match[1]
    );

  if (!parsed) {
    return ctx.reply(
      '❌ Use a value such as 30s, 10m, or 1h.'
    );
  }

  IMAGE_AUTO_BROADCAST.state
    .intervalMs = parsed;

  saveImageAutoBroadcastState();

  if (
    IMAGE_AUTO_BROADCAST.state
      .enabled
  ) {
    startImageAutoBroadcast();
  }

  await ctx.reply(
    `✅ Interval set to ${formatBroadcastInterval(
      parsed
    )}.`
  );
});

bot.command('autocaption', async (ctx) => {
  if (!isOwner(ctx)) return;

  IMAGE_AUTO_BROADCAST.state.caption =
    ctx.message.text.replace(
      /^\/autocaption\s*/i,
      ''
    );

  saveImageAutoBroadcastState();

  await ctx.reply(
    '✅ Auto-broadcast caption updated.'
  );
});

// ---------- Save image sent to bot ----------

bot.on('photo', async (ctx) => {
  if (!isOwner(ctx)) return;

  try {
    ensureImageAutoBroadcastStorage();

    const largest =
      ctx.message.photo[
        ctx.message.photo.length - 1
      ];

    const link =
      await ctx.telegram.getFileLink(
        largest.file_id
      );

    const res =
      await fetch(link.href);

    if (!res.ok) {
      throw new Error(
        `download failed: ${res.status}`
      );
    }

    const buffer = Buffer.from(
      await res.arrayBuffer()
    );

    const filePath = path.join(
      IMAGE_AUTO_BROADCAST.mediaDir,
      `${Date.now()}.jpg`
    );

    fs.writeFileSync(
      filePath,
      buffer
    );

    IMAGE_AUTO_BROADCAST.state.imagePath =
      filePath;

    IMAGE_AUTO_BROADCAST.state.savedAt =
      new Date().toISOString();

    saveImageAutoBroadcastState();

    await ctx.reply(
      '✅ Image saved.\n\nUse /sendimage for a one-time broadcast or /autosend on 1h for scheduled sending.'
    );
  } catch (e) {
    console.error(
      'Could not save broadcast image:',
      e
    );

    await ctx.reply(
      '❌ Could not save the image.'
    );
  }
});

// ---------- Start ----------

async function main() {
  setupSchedules();
  loadCustomSchedules();
  await setupCommandMenus();

  await bot.launch();

  console.log(
    '🤖 Telegram Bot API started.'
  );
}

main().catch((error) => {
  console.error(
    '❌ Bot failed to start:',
    error
  );

  process.exit(1);
});

process.once(
  'SIGINT',
  () => bot.stop('SIGINT')
);

process.once(
  'SIGTERM',
  () => bot.stop('SIGTERM')
);
