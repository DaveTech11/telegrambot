module.exports = {
  // Get this from @BotFather
  BOT_TOKEN: '8926829102:AAFJivM7MbkGUJf5-xDnWVtc-rlqcZMc-QI',

  // Automatically set this image as the bot profile picture every time the bot deploys/starts.
  UPDATE_PIC_ON_DEPLOY: true,
  PROFILE_PIC_URL: 'https://files.catbox.moe/dhyvzq.jpg',

  // Your numeric Telegram user ID(s) - only these people can run owner commands
  OWNER_IDS: [7724436551],

  // Group/channel IDs the bot should post to (usually negative numbers)
  TARGET_CHATS: [-1001234567890],

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
