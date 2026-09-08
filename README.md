# Telegram broadcast bot (Node.js)

Sends scheduled text/images to groups & channels where it's admin, updates its own profile picture, and keeps its real controls hidden from regular users.

## Setup

1. Requires **Node.js 18+**.
2. `npm install`
3. Get `API_ID` / `API_HASH` from https://my.telegram.org (log in → API development tools).
4. Create a bot and get `BOT_TOKEN` from **@BotFather**.
5. Fill in `config.js`:
   - `OWNER_IDS`: your numeric Telegram user ID (message **@userinfobot** to get it).
   - `TARGET_CHATS`: the group/channel IDs to post to. Add the bot to each and **promote it to admin** (needs "Post Messages" permission on channels).
   - Drop `profile.jpg`, `recurring.jpg`, `daily.jpg` into the project folder, or point the paths elsewhere.
6. Run: `npm start`

## What a regular user sees

Tapping **Start** shows a friendly greeting with two buttons: **Help** and **About**. That's it. Telegram's own "/" command menu only lists `/start`, `/help`, `/about` for everyone — the admin commands are never registered there, so they don't show up in the menu even for you unless you know to type them.

## What the owner can do

Owner = anyone whose numeric ID is in `OWNER_IDS`.

- **`/admin`** — the unlock command. Not listed anywhere, does nothing visible if a non-owner sends it (looks like an unrecognized command). For an owner, it opens an inline-button panel:
  - 📊 Status — admin status per target chat
  - 📋 List Schedules — all custom scheduled posts
  - 📨 Send now (how) / 🖼 Set picture (how) / ⏰ Schedule a post (how) / 🗑 Remove a schedule (how) — each shows the exact command to type, since Telegram buttons can't collect free text themselves.

- **The real commands** (work when typed by an owner, whether or not `/admin` was used first):
  - `/send <message>` — broadcast once, right now.
  - `/setpic` — reply to a photo to set it as the bot's avatar.
  - `/schedule HH:MM <message>` — add a daily post at that time (reply to a photo to attach an image). Persists in `schedules.json`.
  - `/schedules` — list custom schedules with their IDs.
  - `/unschedule <id>` — remove one.
  - `/status` — admin status per target chat.

## Always-on behavior

- **On deploy**: updates the bot's profile picture from `PROFILE_PIC_PATH` (if `UPDATE_PIC_ON_DEPLOY = true`).
- **Every 2 minutes**: posts `RECURRING_TEXT` + `RECURRING_IMAGE_PATH` to every admin chat.
- **At each `config.js` `DAILY_TIMES`** and **every `/schedule`d time**: posts the matching text/image.
- All broadcasts automatically skip any chat where the bot isn't currently an admin.

## Notes

- Bots changing their own profile photo works via the raw MTProto call here (through the `telegram`/GramJS library) — the plain Bot API has no endpoint for it. If it errors for your bot, set the picture once manually via **@BotFather → /setuserpic** as a fallback.
- To find a group/channel's numeric ID: add the bot, then check the Status button's output, or forward a message from the chat to **@userinfobot**.
- Keep `BOT_TOKEN`, `API_HASH`, and `OWNER_IDS` private — anyone in `OWNER_IDS` has full control of the bot.
- Run this on a small always-on host (VPS, Railway, Render, a Raspberry Pi, etc.) since it needs to stay running for the cron jobs to fire.


## Color system

Version `1.1` adds a configurable visual color system.

Telegram bots cannot apply arbitrary CSS/font colors to normal message text, so the bot uses **color-coded emoji indicators** plus Telegram's supported HTML formatting. This keeps the interface visually consistent without pretending Telegram supports real text colors.

Configure it in `config.js`:

```js
COLOR_SYSTEM: {
  enabled: true,
  theme: 'blue',
  prefix: true,
  boldHeadings: true
}
```

Available themes:

- `blue`
- `green`
- `red`
- `purple`
- `gold`
- `monochrome`

The owner can type `/colors` to view the active theme and available themes. Change the `theme` value in `config.js`, then restart the bot.


# V2 Full Upgrade

Added a dependency-free management layer:

- 🎨 Color/theme system
- 👑 Owner control center (`/v2`)
- 📊 Statistics (`/stats`)
- 📢 Owner broadcast (`/broadcast`)
- 💬 Chat tracking and enable/disable (`/chat <chat_id> on|off`)
- 📝 Persistent message templates (`/template`, `/templates`)
- ⏰ Schedule overview
- 🛡 Maintenance mode and owner-only controls
- 📜 Persistent audit logs
- ⚙️ Settings view
- 💾 Persistent JSON data in `data/bot-v2.json`

## Commands

`/v2` — open the owner control center  
`/stats` — bot statistics  
`/broadcast MESSAGE` — broadcast to tracked enabled chats  
`/chat CHAT_ID on|off` — enable/disable a tracked chat  
`/theme THEME` — change theme  
`/template NAME | MESSAGE` — save a template  
`/templates` — list templates  
`/maintenance on|off` — maintenance switch  
`/colors` — view color-system information

The original bot functionality remains in place. Start the bot using the same command you were already using for the original project.


## 🖼️ V3 Image Auto-Broadcast

Send a photo to the bot as the owner. The bot saves the newest photo locally.

Commands:
- `/sendimage` — send the saved image once to tracked groups.
- `/autosend on 1h` — enable scheduled sending (examples: `30m`, `2h`).
- `/autosend off` — stop scheduled sending.
- `/autointerval 30m` — change the interval.
- `/autocaption Your caption` — set the caption.
- `/autostatus` — show saved image, tracked groups, status and interval.

The feature is owner-only and deliberately paced between groups. It does not implement an unlimited rapid-fire spam loop.
