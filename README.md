# RetroShelf

A local game library for DOS and SCUMM games, launched through DOSBox Staging and ScummVM with per-game optimized configs.

RetroShelf scans the folders where your games already live, identifies each game, and gives them a browsable shelf with box art, screenshots, metadata, play time, and tuning controls. It writes a DOSBox Staging config for each game so you can launch it without editing `.conf` files by hand.

## Features

- Scan library folders and match games against a curated DOS catalog
- Launch through DOSBox Staging or ScummVM
- Generate per-game DOSBox configs from era profiles plus per-game overrides
- Fetch metadata and artwork from MobyGames, Wikipedia, LaunchBox, libretro, and the Internet Archive
- Track favorites, play time, last played, hidden games, cover art, and screenshots
- Review and tune generated configs before launching

## Requirements

- Node.js 22.17 or newer
- DOSBox Staging and/or ScummVM
- A MobyGames API key is optional; metadata lookups that need it are skipped without one

## Development

```sh
npm install
npm start
```

Run the test suite:

```sh
npm test
```

Build a packaged app for the current platform:

```sh
npm run package
```

Create platform installers:

```sh
npm run make
```

## Data

RetroShelf keeps its data in a `RetroShelf-data` folder next to the app (or next to the source checkout when running from source). This includes `library.json`, generated configs, captures, downloaded media, and logs.

RetroShelf does not include or download games. You point it at game folders you already own.

## License

MIT
