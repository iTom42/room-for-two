# Room for Two

Tic-tac-toe for two devices. One person starts a game and gets a four-letter
room code and a QR of the join link, the other scans it — or types the code —
and both see the same board.

It exists to make one point: **this is where a single HTML file stops being
enough.**

Everything else in the talk is one file you can open from a USB stick. This
cannot be. Two people, two devices, one shared truth about whose turn it is —
that truth has to live somewhere both devices can reach. That somewhere is a
server, and a server has to run somewhere.

## Run it on your machine

```bash
npm install
npm start
```

Open http://localhost:3000, click **Start a game**, then open the same address
in a second window and type the code. From a phone on the same network, scan
the QR — but point the phone at your machine's LAN address rather than
`localhost`, which on a phone means the phone.

## Run it on the internet

There is no build step and no database. It needs a Node process and a port.

- `PORT` is read from the environment, so any host that sets it will work.
- `npm start` is the whole run command.
- `/health` returns `ok`.

## What is in here

| File | What it does |
| --- | --- |
| `server.js` | Serves the page and holds the rooms. All of the shared state is the `rooms` map. |
| `public/index.html` | The whole client: markup, style and script in one file, including a small QR encoder. |

The QR is drawn in the browser from about 150 lines of the spec — byte mode,
error correction M, versions 1 to 6. No library and no CDN, because the join
screen is the one screen that has to work when the venue wifi does not.

Rooms live in memory. Restart the process and the games are gone — which is
fine for what this is, and is itself worth a sentence on stage.

If a player's connection drops (a phone going to sleep is the usual reason)
their seat is kept open and the board is preserved. They rejoin with the same
code and carry on.

## Style

Light background, dark text, a lot of white space, one accent colour —
Ferrari red. The same six-part prompt that made everything else in the talk
made this too.
