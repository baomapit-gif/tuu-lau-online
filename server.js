// Tửu Lầu Bựa Hiệp — online server (internal, few players only).
// Node.js + ws. No paid deps. Serves the game HTML on HTTP and the
// WebSocket room protocol on /ws, same port.
// Admin model (server-side, never trust the client):
//   - First player to create/join an empty room is the admin (room creator).
//   - Only the admin can kick, mute/unmute, or close the room.
//   - A kicked player (by name, normalised) cannot rejoin that room while
//     the room still exists. If the admin disconnects, the oldest remaining
//     player is promoted to admin so the room can continue.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const MAX_PLAYERS = 6;
const ROOT = __dirname;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function normName(s) {
  return String(s || '').trim().slice(0, 20);
}
function normRoom(s) {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}
function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

const rooms = new Map(); // code -> room
let nextId = 1;

function publicPlayer(p) {
  return { id: p.id, name: p.name, admin: p.admin, muted: p.muted, x: p.x, z: p.z, ry: p.ry };
}
function broadcast(room, obj, except) {
  const data = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p !== except && p.ws.readyState === 1) p.ws.send(data);
  }
}
function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function sendPlayerList(room) {
  broadcast(room, { type: 'player_list', players: [...room.players.values()].map(publicPlayer) });
}
function closeRoom(room, reason) {
  broadcast(room, { type: 'room_closed', reason });
  for (const p of [...room.players.values()]) {
    try { p.ws.close(1000, reason); } catch (_) {}
  }
  rooms.delete(room.code);
}

const httpServer = http.createServer((req, res) => {
  let urlPath = '/';
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) {}
  if (urlPath === '/') urlPath = '/tuu-lau-online.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  const client = { ws, id: null, name: '', room: null, admin: false, muted: false, x: 0, z: 2.6, ry: Math.PI, lastMove: 0 };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch (_) { return send(ws, { type: 'error', message: 'Tin nhắn không hợp lệ.' }); }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      if (client.room) return send(ws, { type: 'error', message: 'Bạn đã ở trong phòng rồi.' });
      const name = normName(msg.name);
      const code = normRoom(msg.room);
      if (!name) return send(ws, { type: 'error', message: 'Cần nhập tên.' });
      if (code.length < 3) return send(ws, { type: 'error', message: 'Mã phòng cần ít nhất 3 ký tự (chữ/số).' });
      let room = rooms.get(code);
      if (!room) {
        room = { code, players: new Map(), kickedNames: new Set() };
        rooms.set(code, room);
      }
      if (room.kickedNames.has(name.toLowerCase())) {
        return send(ws, { type: 'error', message: 'Bạn đã bị kick khỏi phòng này và không thể vào lại trong phiên này.' });
      }
      if (room.players.size >= MAX_PLAYERS) {
        return send(ws, { type: 'error', message: 'Phòng đã đủ 6 người.' });
      }
      for (const p of room.players.values()) {
        if (p.name.toLowerCase() === name.toLowerCase()) {
          return send(ws, { type: 'error', message: 'Tên này đã có người dùng trong phòng, đổi tên khác.' });
        }
      }
      client.id = 'p' + (nextId++);
      client.name = name;
      client.room = room;
      client.admin = room.players.size === 0; // first player = creator = admin
      room.players.set(client.id, client);
      send(ws, { type: 'welcome', id: client.id, admin: client.admin, room: code, players: [...room.players.values()].map(publicPlayer) });
      broadcast(room, { type: 'player_joined', player: publicPlayer(client) }, client);
      sendPlayerList(room);
      return;
    }

    // Everything below requires being in a room.
    const room = client.room;
    if (!room || !room.players.has(client.id)) {
      return send(ws, { type: 'error', message: 'Bạn chưa vào phòng.' });
    }

    if (msg.type === 'move') {
      const now = Date.now();
      if (now - client.lastMove < 40) return; // ~25/s hard cap; client sends 10/s
      client.lastMove = now;
      client.x = clampNum(msg.x, -12, 12, client.x);
      client.z = clampNum(msg.z, -8, 8, client.z);
      client.ry = clampNum(msg.ry, -Math.PI * 2, Math.PI * 2, client.ry);
      broadcast(room, { type: 'move', id: client.id, x: client.x, z: client.z, ry: client.ry }, client);
      return;
    }

    if (msg.type === 'chat') {
      if (client.muted) return send(ws, { type: 'error', message: 'Bạn đang bị mute, không gửi chat được.' });
      const text = String(msg.text || '').trim().slice(0, 200);
      if (!text) return;
      broadcast(room, { type: 'chat', from: client.id, name: client.name, text, at: Date.now() });
      return;
    }

    if (msg.type === 'kick') {
      if (!client.admin) return send(ws, { type: 'error', message: 'Chỉ admin mới kick được.' });
      const target = room.players.get(String(msg.targetId));
      if (!target || target === client) return send(ws, { type: 'error', message: 'Không tìm thấy người cần kick.' });
      room.kickedNames.add(target.name.toLowerCase());
      send(target.ws, { type: 'kicked', reason: 'Bạn đã bị admin kick khỏi phòng.' });
      try { target.ws.close(4001, 'kicked'); } catch (_) {}
      return;
    }

    if (msg.type === 'mute') {
      if (!client.admin) return send(ws, { type: 'error', message: 'Chỉ admin mới mute được.' });
      const target = room.players.get(String(msg.targetId));
      if (!target || target === client) return send(ws, { type: 'error', message: 'Không tìm thấy người cần mute.' });
      target.muted = !!msg.muted;
      send(target.ws, { type: 'muted', muted: target.muted });
      sendPlayerList(room);
      return;
    }

    if (msg.type === 'close') {
      if (!client.admin) return send(ws, { type: 'error', message: 'Chỉ admin mới đóng phòng được.' });
      closeRoom(room, 'Admin đã đóng phòng.');
      return;
    }

    if (msg.type === 'leave') {
      try { ws.close(1000, 'leave'); } catch (_) {}
      return;
    }
  });

  ws.on('close', () => {
    const room = client.room;
    if (!room || !room.players.has(client.id)) return;
    const wasAdmin = client.admin;
    room.players.delete(client.id);
    broadcast(room, { type: 'player_left', id: client.id, name: client.name });
    if (room.players.size === 0) {
      rooms.delete(room.code);
      return;
    }
    if (wasAdmin) {
      // Promote the oldest remaining player so the room survives.
      const next = [...room.players.values()][0];
      next.admin = true;
      send(next.ws, { type: 'admin_promoted' });
      broadcast(room, { type: 'chat', from: 'system', name: 'Hệ thống', text: next.name + ' trở thành admin phòng.', at: Date.now() });
    }
    sendPlayerList(room);
  });
});

httpServer.listen(PORT, () => {
  console.log('Tuu Lau online server: http://localhost:' + PORT + '/  (ws: /ws, max 6/phong)');
});
