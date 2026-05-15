// ═══════════════════════════════════════════════════
//  GroupChat Server  —  Node.js + Socket.io
//  Chạy: node server.js
//  Mở:   http://localhost:3000
// ═══════════════════════════════════════════════════
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { v4: uuid } = require('uuid');
const path = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PORT = process.env.PORT || 3000;

// ── Dữ liệu lưu trong RAM ───────────────────────────
const users = {};   // socketId → user object
const groups = {    // id → { id, name, emoji, messages[], members Set }
  'chung':   { id:'chung',   name:'Chung',      emoji:'💬', messages:[], members:new Set() },
  'congviec':{ id:'congviec',name:'Công Việc',   emoji:'💼', messages:[], members:new Set() },
  'vuilon':  { id:'vuilon',  name:'Vui Lộn 🎉', emoji:'🎊', messages:[], members:new Set() },
};

// ── Static files ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Socket.io ───────────────────────────────────────
io.on('connection', socket => {

  // 1️⃣  ĐĂNG NHẬP
  socket.on('login', ({ name, avatar, color }) => {
    const user = {
      id: socket.id,
      name: name.trim().slice(0, 24) || 'Khách',
      avatar,
      color,
      group: 'chung',
      online: true,
    };
    users[socket.id] = user;

    // Vào nhóm mặc định
    socket.join('chung');
    groups['chung'].members.add(socket.id);

    // Gửi state ban đầu cho người vừa vào
    socket.emit('welcome', {
      me: user,
      groups: serializeGroups(),
      onlineUsers: getOnlineUsers(),
      messages: groups['chung'].messages.slice(-60),
    });

    // Báo mọi người có người mới
    io.emit('users:update', getOnlineUsers());
    socket.to('chung').emit('sys:msg', {
      gid: 'chung',
      text: `${user.avatar} ${user.name} đã tham gia!`,
      time: now(),
    });

    console.log(`+ ${user.name} [${socket.id}]`);
  });

  // 2️⃣  CHUYỂN NHÓM
  socket.on('group:join', gid => {
    const user = users[socket.id];
    if (!user || !groups[gid]) return;

    if (user.group) {
      socket.leave(user.group);
      groups[user.group]?.members.delete(socket.id);
    }
    socket.join(gid);
    user.group = gid;
    groups[gid].members.add(socket.id);

    socket.emit('group:history', {
      gid,
      messages: groups[gid].messages.slice(-60),
    });
  });

  // 3️⃣  GỬI TIN NHẮN NHÓM
  socket.on('group:msg', ({ gid, text, replyTo }) => {
    const user = users[socket.id];
    if (!user || !text?.trim()) return;
    const msg = buildMsg(user, text, replyTo);
    groups[gid]?.messages.push(msg);
    trimMessages(groups[gid]?.messages);
    io.to(gid).emit('group:msg', { gid, msg });
  });

  // 4️⃣  GỬI ẢNH (base64) NHÓM
  socket.on('group:image', ({ gid, dataUrl }) => {
    const user = users[socket.id];
    if (!user || !dataUrl) return;
    const msg = buildMsg(user, null, null, dataUrl);
    groups[gid]?.messages.push(msg);
    trimMessages(groups[gid]?.messages);
    io.to(gid).emit('group:msg', { gid, msg });
  });

  // 5️⃣  TIN NHẮN RIÊNG (DM)
  socket.on('dm:send', ({ toId, text, replyTo }) => {
    const user = users[socket.id];
    const to   = users[toId];
    if (!user || !to || !text?.trim()) return;
    const msg = buildMsg(user, text, replyTo);
    socket.emit('dm:msg', { fromId: socket.id, toId, msg });
    io.to(toId).emit('dm:msg', { fromId: socket.id, toId, msg });
    io.to(toId).emit('dm:notify', { from: user, text });
  });

  // 6️⃣  ẢNH RIÊNG
  socket.on('dm:image', ({ toId, dataUrl }) => {
    const user = users[socket.id];
    if (!user || !dataUrl) return;
    const msg = buildMsg(user, null, null, dataUrl);
    socket.emit('dm:msg', { fromId: socket.id, toId, msg });
    io.to(toId).emit('dm:msg', { fromId: socket.id, toId, msg });
  });

  // 7️⃣  REACTION
  socket.on('msg:react', ({ gid, msgId, emoji, isDm, toId }) => {
    const user = users[socket.id];
    if (!user) return;
    const data = { msgId, emoji, by: socket.id, isDm, gid, toId };
    if (isDm) {
      socket.emit('msg:react', data);
      io.to(toId).emit('msg:react', data);
    } else {
      io.to(gid).emit('msg:react', data);
    }
  });

  // 8️⃣  TYPING
  socket.on('typing:on',  ({ gid, isDm, toId }) => {
    const u = users[socket.id];
    if (!u) return;
    if (isDm) io.to(toId).emit('typing:on',  { user: u, isDm, fromId: socket.id });
    else      socket.to(gid).emit('typing:on', { user: u, gid });
  });
  socket.on('typing:off', ({ gid, isDm, toId }) => {
    if (isDm) io.to(toId).emit('typing:off',  { fromId: socket.id, isDm });
    else      socket.to(gid).emit('typing:off', { fromId: socket.id, gid });
  });

  // 9️⃣  WEBRTC SIGNALING — Gọi điện / Video 1-1
  socket.on('call:offer',  ({ toId, offer, type }) => {
    const u = users[socket.id];
    io.to(toId).emit('call:offer', { fromId: socket.id, fromName: u?.name, fromAvatar: u?.avatar, fromColor: u?.color, offer, type });
  });
  socket.on('call:answer', ({ toId, answer })    => io.to(toId).emit('call:answer', { answer }));
  socket.on('call:ice',    ({ toId, candidate }) => io.to(toId).emit('call:ice',    { candidate }));
  socket.on('call:end',    ({ toId })            => io.to(toId).emit('call:ended'));
  socket.on('call:reject', ({ toId })            => io.to(toId).emit('call:rejected'));

  // 🔟  WEBRTC — Gọi nhóm
  socket.on('gcall:start',  ({ gid, type }) => {
    const u = users[socket.id];
    socket.to(gid).emit('gcall:invite', { fromId: socket.id, fromName: u?.name, fromAvatar: u?.avatar, gid, type });
  });
  socket.on('gcall:offer',  ({ toId, offer })     => io.to(toId).emit('gcall:offer',  { fromId: socket.id, offer }));
  socket.on('gcall:answer', ({ toId, answer })    => io.to(toId).emit('gcall:answer', { fromId: socket.id, answer }));
  socket.on('gcall:ice',    ({ toId, candidate }) => io.to(toId).emit('gcall:ice',    { fromId: socket.id, candidate }));
  socket.on('gcall:leave',  ({ gid })             => socket.to(gid).emit('gcall:left', { fromId: socket.id }));

  // ❌  NGẮT KẾT NỐI
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (!user) return;
    console.log(`- ${user.name} [${socket.id}]`);
    if (user.group) groups[user.group]?.members.delete(socket.id);
    delete users[socket.id];
    io.emit('users:update', getOnlineUsers());
  });
});

// ── Helpers ─────────────────────────────────────────
function buildMsg(user, text, replyTo, imageUrl) {
  return {
    id: uuid(),
    sender: { id: user.id, name: user.name, avatar: user.avatar, color: user.color },
    text: text || null,
    imageUrl: imageUrl || null,
    replyTo: replyTo || null,
    reactions: {},
    time: now(),
  };
}
function trimMessages(arr) {
  if (arr && arr.length > 200) arr.splice(0, arr.length - 200);
}
function now() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}
function getOnlineUsers() {
  return Object.values(users).map(u => ({
    id: u.id, name: u.name, avatar: u.avatar, color: u.color, group: u.group,
  }));
}
function serializeGroups() {
  return Object.values(groups).map(g => ({
    id: g.id, name: g.name, emoji: g.emoji, count: g.members.size,
  }));
}

// ── Start ────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log(`║  GroupChat đang chạy tại port ${PORT}    ║`);
  console.log(`║  Mở: http://localhost:${PORT}            ║`);
  console.log('║  Chia sẻ LAN: dùng IP máy tính bạn   ║');
  console.log('╚══════════════════════════════════════╝\n');
});
