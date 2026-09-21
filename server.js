// room-for-two — two players, one room code, one shared board.
//
// This is the whole point of the demo: the state below lives in ONE place,
// in this process. A single HTML file cannot do that. That is why it needs
// a server, and why a server needs somewhere to run.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(here, 'public', safe);
  try {
    const body = await readFile(file);
    const ext = safe.slice(safe.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

// ---- the shared state ----------------------------------------------------

// code -> { board, turn, seats: [wsX, wsO], over, started }
// Seats are fixed: seat 0 is always X, seat 1 is always O. A player who drops
// (a phone that went to sleep) leaves an empty seat, not a dead room — they
// rejoin with the same code and get their mark and the board back.
const rooms = new Map();

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// No I, O, 0 or 1 — people read these out loud over a call.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function winner(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { mark: board[a], line };
  }
  return board.every(Boolean) ? { mark: null, line: null } : null;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  const result = winner(room.board);
  room.over = !!result;
  const ready = room.seats.every(Boolean);
  room.seats.forEach((ws, i) => {
    if (!ws) return;
    send(ws, {
      type: 'state',
      board: room.board,
      turn: room.turn,
      you: i === 0 ? 'X' : 'O',
      ready,
      paused: !ready && room.started,
      code: room.code,
      over: room.over,
      winner: result ? result.mark : null,
      line: result ? result.line : null,
    });
  });
}

function resetRoom(room) {
  room.board = Array(9).fill(null);
  room.turn = 'X';
  room.over = false;
}

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const code = newCode();
      const room = { code, seats: [ws, null], board: [], turn: 'X', over: false, started: false };
      resetRoom(room);
      rooms.set(code, room);
      ws.room = room;
      return broadcast(room);
    }

    if (msg.type === 'join') {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return send(ws, { type: 'error', reason: 'no-room' });
      const seat = room.seats.indexOf(null);
      if (seat === -1) return send(ws, { type: 'error', reason: 'full' });
      room.seats[seat] = ws;
      room.started = true;
      ws.room = room;
      return broadcast(room);
    }

    if (msg.type === 'move') {
      const room = ws.room;
      if (!room || room.over || !room.seats.every(Boolean)) return;
      if (!Number.isInteger(msg.cell) || msg.cell < 0 || msg.cell > 8) return;
      const you = room.seats[0] === ws ? 'X' : 'O';
      if (you !== room.turn) return;                 // not your turn
      if (room.board[msg.cell] !== null) return;     // taken
      room.board[msg.cell] = you;
      room.turn = you === 'X' ? 'O' : 'X';
      return broadcast(room);
    }

    if (msg.type === 'again') {
      const room = ws.room;
      if (!room) return;
      resetRoom(room);
      return broadcast(room);
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    const seat = room.seats.indexOf(ws);
    if (seat !== -1) room.seats[seat] = null;
    if (room.seats.every((s) => s === null)) {
      room.emptySince = Date.now();
      return;
    }
    broadcast(room); // the one still there sees "they dropped", board intact
  });
});

// Rooms nobody came back to. Ten minutes is long enough to survive a demo.
const EMPTY_TTL = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.seats.every((s) => s === null) && now - (room.emptySince || now) > EMPTY_TTL) {
      rooms.delete(code);
    }
  }
}, 60000).unref();

// Railway's proxy drops sockets that go quiet. Keep them warm.
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
wss.on('close', () => clearInterval(heartbeat));

http.listen(PORT, '0.0.0.0', () => {
  console.log(`room-for-two listening on ${PORT}`);
});
