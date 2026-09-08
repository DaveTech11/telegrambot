module.exports = {
  // Get these from https://my.telegram.org (API development tools)
  API_ID: 37815271,
  API_HASH: '1EV9MEuZGVTTjnmf9hXmuY9tVMUn7SsJzH',

  // Get this from @BotFather
  BOT_TOKEN: '8274768080:AAEEzl6UCl7sW-EX7jcUD0XR9JOBkYKkJ4g',

  // Your numeric Telegram user ID(s) - only these people can run /setpic, /send, /status
  OWNER_IDS: [7724436551],

  // Group/channel IDs the bot should post to (usually negative numbers)
  TARGET_CHATS: [-1001234567890],
  
  // --- Profile picture ---
  PROFILE_PIC_PATH: './profile.jpg',
  UPDATE_PIC_ON_DEPLOY: true,

  // --- Every-2-minutes recurring post ---
  RECURRING_TEXT: 'Automated update',
  RECURRING_IMAGE_PATH: './recurring.jpg', // set to null for text-only

  // --- Fixed daily times (24h "HH:MM") ---
  DAILY_TIMES: ['09:00', '18:30'],
  DAILY_TEXT: 'Scheduled announcement',
  DAILY_IMAGE_PATH: './daily.jpg', // set to null for text-only

  // --- Color system ---
  // Telegram does not support arbitrary text colors in bot messages, so this
  // system uses color-coded emoji indicators + HTML formatting.
  COLOR_SYSTEM: {
    enabled: true,
    theme: 'blue', // blue | green | red | purple | gold | monochrome
    prefix: true,
    boldHeadings: true
  }
};
