# MiniMax Studio

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-yellow)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)

Web-based studio for the [MiniMax API](https://www.minimaxi.com/) — supports text chat, image generation, video synthesis, speech, and music creation in a single interface with session history.

## Features

- **Text Chat** — Conversation with MiniMax language models, with session save and restore
- **Image Generation** — Text-to-image and image-to-image via MiniMax Image API
- **Video Synthesis** — Text-to-video and image-to-video generation
- **Speech Synthesis** — Text-to-speech with configurable voice, speed, and emotion
- **Music & Lyrics** — AI music and lyric generation
- **Two modes** — Backend mode (Node.js + SQLite, with user auth and quota tracking) and Direct mode (API key stored in browser localStorage)
- **Responsive UI** — Adapts to mobile, tablet, and desktop viewports

## Installation

### Backend Mode (recommended)

```bash
# Clone the repo
git clone https://github.com/Luckycat133/minimax-studio.git
cd minimax-studio

# Configure environment
cp server/.env.example server/.env
# Edit server/.env and set MINIMAX_API_KEY and other values

# Install server dependencies
cd server && npm install

# Start the server
node server.js
```

Then open `http://localhost:3000` in your browser.

### Direct Mode (no backend)

Open `index.html` in a browser directly, or serve it with any static file server. Enter your MiniMax API key when prompted — it is stored only in `localStorage`.

## Project Structure

```
minimax-studio/
├── index.html          # Main HTML entry point
├── css/
│   ├── styles.css      # Core styles
│   └── themes.css      # Theme variables
├── js/
│   ├── app.js          # Main application controller
│   ├── api.js          # MiniMax API client (direct mode)
│   ├── backend-api.js  # Backend API client
│   ├── models.js       # Model definitions and config panels
│   ├── templates.js    # HTML template helpers
│   └── utils.js        # Shared utilities
└── server/
    ├── server.js       # Express server with SQLite
    └── package.json
```

## Requirements

- Node.js 18+ (backend mode only)
- A valid [MiniMax API key](https://www.minimaxi.com/)

## License

MIT
