// ═══════════════════════════════════════════════════
//  GroupChat — Client  (Socket.io + WebRTC)
// ═══════════════════════════════════════════════════

const AVATARS = ['😊','😎','🥳','🤩','😄','🤗','😇','🦊','🐼','🦁','🐸','🐯','🦋','🌟','🔥','💎'];
const COLORS  = ['#6c63ff','#ec4899','#06b6d4','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6'];
const EMOJIS  = ['😄','😂','🥰','🔥','👍','🎉','💯','🤔','😎','❤️','✅','😭','🙏','👏','💪','🌟','😅','🫡','💀','🤑'];

// ── State ────────────────────────────────────────────
let socket, me;
let currentRoom  = null;   // { type:'group'|'dm', id, name, emoji, color }
let messages     = {};     // roomKey → [ msg, ... ]
let onlineUsers  = {};     // socketId → user
let groups       = {};     // gid → group
let badges       = {};     // roomKey → count
let replyTo      = null;
let typingTimer  = null;
let selAvatar    = AVATARS[0];
let selColor     = COLORS[0];

// WebRTC
let peerConn = null, localStream = null;
let callState = null; // null | 'calling' | 'ringing' | 'active'
let callPeer  = null; // { id, name, avatar, color, type }
let callTimer = null, callSecs = 0;
let isMuted = false, isSpeaker = false, isCamOff = false;
let incomingOffer = null;

// ── Login screen setup ───────────────────────────────
(function setupLogin() {
  const avaRow = document.getElementById('avatar-row');
  const colRow = document.getElementById('color-row');

  AVATARS.forEach((a, i) => {
    const d = document.createElement('div');
    d.className = 'ava-opt' + (i === 0 ? ' sel' : '');
    d.textContent = a;
    d.onclick = () => { document.querySelectorAll('.ava-opt').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); selAvatar = a; };
    avaRow.appendChild(d);
  });
  COLORS.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'col-opt' + (i === 0 ? ' sel' : '');
    d.style.background = c;
    d.onclick = () => { document.querySelectorAll('.col-opt').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); selColor = c; };
    colRow.appendChild(d);
  });

  document.getElementById('inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('btn-login').onclick = doLogin;
})();

function doLogin() {
  const name = document.getElementById('inp-name').value.trim();
  const err  = document.getElementById('login-error');
  if (!name) { err.textContent = 'Vui lòng nhập tên!'; return; }
  err.textContent = '';
  socket = io();
  setupSocketEvents();
  socket.emit('login', { name, avatar: selAvatar, color: selColor });
}

// ── Socket events ─────────────────────────────────────
function setupSocketEvents() {

  socket.on('welcome', data => {
    me = data.me;
    groups = {};
    data.groups.forEach(g => { groups[g.id] = g; });
    onlineUsers = {};
    data.onlineUsers.forEach(u => { onlineUsers[u.id] = u; });

    document.getElementById('login-screen').style.display  = 'none';
    document.getElementById('app-screen').style.display    = 'flex';

    renderMeCard();
    renderGroups();
    renderUsers();
    buildEmojiPicker();

    // Tự động vào nhóm Chung
    joinGroup('chung', data.messages);
  });

  socket.on('users:update', users => {
    onlineUsers = {};
    users.forEach(u => { onlineUsers[u.id] = u; });
    renderUsers();
    document.getElementById('online-count').textContent = `(${users.length})`;
  });

  // ── Tin nhắn nhóm ──
  socket.on('group:msg', ({ gid, msg }) => {
    const key = 'g:' + gid;
    if (!messages[key]) messages[key] = [];
    messages[key].push(msg);
    if (currentRoom && currentRoom.key === key) {
      appendMsg(msg);
    } else {
      badges[key] = (badges[key] || 0) + 1;
      renderGroups();
      const u = msg.sender;
      showToast(u.avatar, u.name, msg.text || '[Ảnh]');
    }
  });

  socket.on('group:history', ({ gid, messages: msgs }) => {
    const key = 'g:' + gid;
    messages[key] = msgs;
    if (currentRoom?.key === key) renderMessages();
  });

  socket.on('sys:msg', ({ gid, text, time }) => {
    const key = 'g:' + gid;
    if (!messages[key]) messages[key] = [];
    messages[key].push({ id: 'sys' + Date.now(), sys: true, text, time });
    if (currentRoom?.key === key) appendMsg({ sys: true, text, time });
  });

  // ── DM ──
  socket.on('dm:msg', ({ fromId, toId, msg }) => {
    const peerId = fromId === me.id ? toId : fromId;
    const key = 'd:' + peerId;
    if (!messages[key]) messages[key] = [];
    messages[key].push(msg);
    if (currentRoom?.key === key) {
      appendMsg(msg);
    } else if (fromId !== me.id) {
      badges[key] = (badges[key] || 0) + 1;
      renderUsers();
    }
  });

  socket.on('dm:notify', ({ from, text }) => {
    if (currentRoom?.key !== 'd:' + from.id) {
      showToast(from.avatar, from.name, text);
    }
  });

  // ── Reactions ──
  socket.on('msg:react', ({ msgId, emoji, by, gid, isDm, toId }) => {
    const key = isDm ? 'd:' + (by === me.id ? toId : by) : 'g:' + gid;
    const msgs = messages[key] || [];
    const msg  = msgs.find(m => m.id === msgId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const arr = msg.reactions[emoji];
    const idx = arr.indexOf(by);
    if (idx > -1) arr.splice(idx, 1); else arr.push(by);
    if (currentRoom?.key === key) renderMessages();
  });

  // ── Typing ──
  socket.on('typing:on', ({ user, gid, isDm }) => {
    const key = isDm ? 'd:' + user.id : 'g:' + gid;
    if (currentRoom?.key !== key) return;
    document.getElementById('typing-who').textContent = user.name + ' đang nhập...';
    document.getElementById('typing-bar').style.display = 'flex';
  });
  socket.on('typing:off', ({ fromId, gid, isDm }) => {
    document.getElementById('typing-bar').style.display = 'none';
  });

  // ── WebRTC Calls ──
  socket.on('call:offer', async ({ fromId, fromName, fromAvatar, fromColor, offer, type }) => {
    if (callState) { socket.emit('call:reject', { toId: fromId }); return; }
    incomingOffer = { fromId, offer, type };
    callPeer = { id: fromId, name: fromName, avatar: fromAvatar, color: fromColor, type };
    showIncomingCall(fromName, fromAvatar, fromColor, type);
  });
  socket.on('call:answer', async ({ answer }) => {
    if (peerConn) await peerConn.setRemoteDescription(new RTCSessionDescription(answer));
  });
  socket.on('call:ice', async ({ candidate }) => {
    if (peerConn && candidate) await peerConn.addIceCandidate(new RTCIceCandidate(candidate));
  });
  socket.on('call:ended',   () => { if (callState) endCall(true); });
  socket.on('call:rejected',() => {
    showToast('📵','Bị từ chối','Không thể kết nối cuộc gọi');
    endCall(true);
  });
}

// ── Render ────────────────────────────────────────────
function renderMeCard() {
  const el = document.getElementById('me-ava');
  el.textContent     = me.avatar;
  el.style.background = me.color;
  document.getElementById('me-name').textContent = me.name;
}

function renderGroups() {
  const el = document.getElementById('groups-list');
  el.innerHTML = Object.values(groups).map(g => {
    const key = 'g:' + g.id;
    const b   = badges[key] || 0;
    return `<div class="g-item${currentRoom?.key===key?' active':''}" onclick="joinGroup('${g.id}')">
      <div class="g-icon">${g.emoji}</div>
      <div class="g-name">${g.name}</div>
      ${b ? `<div class="g-badge">${b}</div>` : ''}
    </div>`;
  }).join('');
}

function renderUsers() {
  const q   = document.getElementById('search-inp').value.toLowerCase();
  const el  = document.getElementById('users-list');
  const all = Object.values(onlineUsers);
  const shown = q ? all.filter(u => u.name.toLowerCase().includes(q)) : all;
  el.innerHTML = shown.map(u => {
    const key   = 'd:' + u.id;
    const isMe  = u.id === me?.id;
    const b     = badges[key] || 0;
    return `<div class="u-item${currentRoom?.key===key?' active':''}" onclick="${isMe ? '' : `openDM('${u.id}')`}" style="${isMe?'opacity:.55;cursor:default':''}">
      <div class="u-ava" style="background:${u.color}">${u.avatar}<div class="u-dot"></div></div>
      <div class="u-info">
        <div class="u-name">${u.name} ${isMe ? '<span class="u-me-badge">bạn</span>' : ''}</div>
        <div class="u-sub">${isMe ? 'Tài khoản của bạn' : '🟢 Online'}</div>
      </div>
      ${b ? `<div class="g-badge">${b}</div>` : ''}
    </div>`;
  }).join('');
}

function buildEmojiPicker() {
  const box = document.getElementById('emoji-box');
  box.innerHTML = EMOJIS.map(e => `<span class="ep" onclick="insertEmoji('${e}')">${e}</span>`).join('');
}

// ── Join group ────────────────────────────────────────
function joinGroup(gid, existingMsgs) {
  const g   = groups[gid];
  const key = 'g:' + gid;
  currentRoom = { type:'group', id:gid, key, name:g.name, emoji:g.emoji };

  badges[key] = 0;
  if (existingMsgs) messages[key] = existingMsgs;

  updateHeader(g.emoji, g.name, 'group', 'Kênh nhóm');
  document.getElementById('input-bar').style.display = '';

  socket.emit('group:join', gid);
  renderGroups();
  renderUsers();
  renderMessages();
  closeOnMobile();
  cancelReply();
}

// ── Open DM ───────────────────────────────────────────
function openDM(userId) {
  const u   = onlineUsers[userId];
  if (!u) return;
  const key = 'd:' + userId;
  currentRoom = { type:'dm', id:userId, key, name:u.name, emoji:u.avatar, color:u.color };

  badges[key] = 0;
  if (!messages[key]) messages[key] = [];

  updateHeader(u.avatar, u.name, 'dm', '🟢 Đang online');
  document.getElementById('input-bar').style.display = '';

  // Get DM history from server if empty
  if (messages[key].length === 0) socket.emit('dm:history', { toId: userId });

  renderGroups();
  renderUsers();
  renderMessages();
  closeOnMobile();
  cancelReply();
}

// Socket: DM history response
if (socket) socket.on('dm:history', ({ toId, messages: msgs }) => {
  const key = 'd:' + toId;
  messages[key] = msgs;
  if (currentRoom?.key === key) renderMessages();
});

function updateHeader(emoji, name, type, sub) {
  const ava = document.getElementById('ch-ava');
  ava.textContent    = emoji;
  ava.className      = 'ch-ava' + (type === 'group' ? ' group' : '');
  ava.style.background = type === 'group' ? 'rgba(108,99,255,.2)' : (onlineUsers[currentRoom?.id]?.color || '#6c63ff');
  document.getElementById('ch-name').textContent = name;
  document.getElementById('ch-sub').textContent  = sub;

  // Show call buttons only for DM
  document.getElementById('btn-voice').style.display = type === 'dm' ? '' : 'none';
  document.getElementById('btn-video').style.display = type === 'dm' ? '' : 'none';
}

// ── Render all messages ───────────────────────────────
function renderMessages() {
  const wrap = document.getElementById('msgs-wrap');
  const msgs = messages[currentRoom?.key] || [];
  if (!msgs.length) {
    wrap.innerHTML = '<div class="empty-hint">Chưa có tin nhắn nào. Hãy bắt đầu! 👋</div>';
    return;
  }

  let html = `<div class="date-sep"><span>Hôm nay, ${new Date().toLocaleDateString('vi-VN')}</span></div>`;
  let prev = null;
  msgs.forEach(msg => {
    html += buildMsgHTML(msg, prev);
    prev = msg;
  });
  wrap.innerHTML = html;
  wrap.scrollTop = wrap.scrollHeight;
}

function appendMsg(msg) {
  const wrap = document.getElementById('msgs-wrap');
  // Remove empty hint
  const hint = wrap.querySelector('.empty-hint');
  if (hint) hint.remove();

  const msgs = messages[currentRoom?.key] || [];
  const prev = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
  const div  = document.createElement('div');
  div.innerHTML = buildMsgHTML(msg, prev);
  while (div.firstChild) wrap.appendChild(div.firstChild);
  wrap.scrollTop = wrap.scrollHeight;
}

function buildMsgHTML(msg, prev) {
  if (msg.sys) {
    return `<div class="msg-row"><div style="width:100%;text-align:center"><div class="bubble sys">${esc(msg.text)}</div></div></div>`;
  }
  const isMe     = msg.sender?.id === me?.id;
  const showInfo = !isMe && prev?.sender?.id !== msg.sender?.id;
  const s        = msg.sender;

  const avaHtml  = !isMe
    ? `<div class="msg-ava" style="background:${s.color}">${showInfo ? s.avatar : ''}</div>`
    : '';
  const nameHtml = showInfo && !isMe ? `<div class="msg-sender">${s.name}</div>` : '';
  const repHtml  = msg.replyTo ? `<div class="msg-reply">↩ ${esc(msg.replyTo)}</div>` : '';

  let bubble;
  if (msg.imageUrl) {
    bubble = `<div class="bubble img ${isMe?'me':'them'}"><img src="${msg.imageUrl}" alt="ảnh" loading="lazy" onerror="this.style.display='none'"></div>`;
  } else {
    bubble = `<div class="bubble ${isMe?'me':'them'}" data-id="${msg.id}" oncontextmenu="showCtx(event,'${msg.id}')" ondblclick="setReply('${msg.id}')" title="Nhấn đúp để trả lời">${esc(msg.text)}</div>`;
  }

  const rxnHtml = buildReactions(msg);

  return `<div class="msg-row ${isMe?'me':''}">
    ${!isMe ? avaHtml : ''}
    <div class="msg-col">
      ${nameHtml}${repHtml}${bubble}${rxnHtml}
      <div class="msg-time">${msg.time}</div>
    </div>
  </div>`;
}

function buildReactions(msg) {
  if (!msg.reactions || !Object.keys(msg.reactions).length) return '';
  return '<div class="rxn-row">' +
    Object.entries(msg.reactions)
      .filter(([, arr]) => arr.length > 0)
      .map(([e, arr]) =>
        `<span class="rxn" onclick="react('${msg.id}','${e}')">${e}<span class="rxn-count">${arr.length}</span></span>`)
      .join('') +
    '</div>';
}

// ── Send message ──────────────────────────────────────
function sendMsg() {
  const inp  = document.getElementById('msg-inp');
  const text = inp.value.trim();
  if (!text || !currentRoom) return;

  if (currentRoom.type === 'group') {
    socket.emit('group:msg', { gid: currentRoom.id, text, replyTo: replyTo?.text || null });
  } else {
    socket.emit('dm:send', { toId: currentRoom.id, text, replyTo: replyTo?.text || null });
  }
  inp.value = '';
  inp.style.height = 'auto';
  cancelReply();
  stopTyping();
}

// ── Send image ────────────────────────────────────────
document.getElementById('btn-img').onclick = () => document.getElementById('file-inp').click();
document.getElementById('file-inp').onchange = e => {
  const file = e.target.files[0];
  if (!file || !currentRoom) return;
  if (file.size > 5 * 1024 * 1024) { showToast('⚠️','File quá lớn','Tối đa 5 MB'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const dataUrl = ev.target.result;
    if (currentRoom.type === 'group') socket.emit('group:image', { gid: currentRoom.id, dataUrl });
    else socket.emit('dm:image', { toId: currentRoom.id, dataUrl });
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

// ── Input helpers ─────────────────────────────────────
document.getElementById('msg-inp').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});
document.getElementById('msg-inp').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 130) + 'px';
  startTyping();
});
document.getElementById('btn-send').onclick = sendMsg;
document.getElementById('search-inp').addEventListener('input', renderUsers);

function startTyping() {
  clearTimeout(typingTimer);
  if (!currentRoom) return;
  socket.emit('typing:on', { gid: currentRoom.id, isDm: currentRoom.type === 'dm', toId: currentRoom.id });
  typingTimer = setTimeout(stopTyping, 2500);
}
function stopTyping() {
  if (!currentRoom) return;
  socket.emit('typing:off', { gid: currentRoom.id, isDm: currentRoom.type === 'dm', toId: currentRoom.id });
}

// ── Emoji ─────────────────────────────────────────────
document.getElementById('btn-emoji').onclick = () => document.getElementById('emoji-box').classList.toggle('open');
function insertEmoji(e) {
  const inp = document.getElementById('msg-inp');
  inp.value += e;
  inp.focus();
  document.getElementById('emoji-box').classList.remove('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#emoji-box') && !e.target.closest('#btn-emoji'))
    document.getElementById('emoji-box').classList.remove('open');
  if (!e.target.closest('.ctx')) closeCtx();
});

// ── Reply ─────────────────────────────────────────────
function setReply(msgId) {
  const msgs = messages[currentRoom?.key] || [];
  const msg  = msgs.find(m => m.id === msgId);
  if (!msg || msg.sys) return;
  replyTo = msg;
  document.getElementById('reply-who').textContent      = 'Trả lời ' + (msg.sender?.name || '');
  document.getElementById('reply-preview').textContent  = msg.text || '[Ảnh]';
  document.getElementById('reply-strip').style.display  = 'flex';
  document.getElementById('msg-inp').focus();
}
function cancelReply() {
  replyTo = null;
  document.getElementById('reply-strip').style.display = 'none';
}

// ── Context menu / Reactions ──────────────────────────
let ctxEl = null;
function showCtx(e, msgId) {
  e.preventDefault();
  closeCtx();
  const div = document.createElement('div');
  div.className = 'ctx';
  div.id = 'ctx-menu';
  div.innerHTML =
    `<div class="ctx-row">${['👍','❤️','😂','🔥','😭','🎉'].map(em => `<span class="ctx-e" onclick="react('${msgId}','${em}')">${em}</span>`).join('')}</div>
     <div class="ctx-sep"></div>
     <div class="ctx-item" onclick="setReply('${msgId}');closeCtx()"><i class="ti ti-corner-up-left"></i> Trả lời</div>`;
  div.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  div.style.top  = Math.min(e.clientY, window.innerHeight - 120) + 'px';
  document.body.appendChild(div);
  ctxEl = div;
}
function closeCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }

function react(msgId, emoji) {
  if (!currentRoom) return;
  closeCtx();
  socket.emit('msg:react', {
    msgId, emoji,
    gid: currentRoom.type === 'group' ? currentRoom.id : null,
    isDm: currentRoom.type === 'dm',
    toId: currentRoom.type === 'dm' ? currentRoom.id : null,
  });
}

// ── WebRTC Call ───────────────────────────────────────
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function startCall(type) {
  if (!currentRoom || currentRoom.type !== 'dm') return;
  const target = onlineUsers[currentRoom.id];
  if (!target) return;
  if (callState) { showToast('⚠️','Đang trong cuộc gọi khác',''); return; }

  callPeer  = { id: target.id, name: target.name, avatar: target.avatar, color: target.color, type };
  callState = 'calling';

  try {
    localStream = await navigator.mediaDevices.getUserMedia(
      type === 'video' ? { audio: true, video: true } : { audio: true }
    );
  } catch {
    showToast('❌','Không có quyền truy cập','Vui lòng cho phép micro/camera');
    callState = null;
    return;
  }

  peerConn = createPeer();
  localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));

  if (type === 'video') {
    document.getElementById('local-video').srcObject = localStream;
    document.getElementById('video-wrap').style.display = '';
    document.getElementById('ctrl-cam-wrap').style.display = '';
  }

  const offer = await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);
  socket.emit('call:offer', { toId: target.id, offer, type });

  openCallModal(target.name, target.avatar, target.color, type, 'Đang gọi...');
}

async function acceptCall() {
  document.getElementById('incoming-call').style.display = 'none';
  if (!incomingOffer || !callPeer) return;

  const { fromId, offer, type } = incomingOffer;
  callState = 'active';

  try {
    localStream = await navigator.mediaDevices.getUserMedia(
      type === 'video' ? { audio: true, video: true } : { audio: true }
    );
  } catch {
    showToast('❌','Không có quyền truy cập micro/camera','');
    socket.emit('call:reject', { toId: fromId });
    callState = null;
    return;
  }

  peerConn = createPeer();
  localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));

  if (type === 'video') {
    document.getElementById('local-video').srcObject = localStream;
    document.getElementById('video-wrap').style.display = '';
    document.getElementById('ctrl-cam-wrap').style.display = '';
  }

  await peerConn.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);
  socket.emit('call:answer', { toId: fromId, answer });

  openCallModal(callPeer.name, callPeer.avatar, callPeer.color, type, 'Đang kết nối...');
  startCallTimer();
  incomingOffer = null;
}

function rejectCall() {
  document.getElementById('incoming-call').style.display = 'none';
  if (incomingOffer) socket.emit('call:reject', { toId: incomingOffer.fromId });
  incomingOffer = null;
  callPeer = null;
  callState = null;
}

function createPeer() {
  const pc = new RTCPeerConnection(ICE);
  pc.onicecandidate = e => {
    if (e.candidate && callPeer) socket.emit('call:ice', { toId: callPeer.id, candidate: e.candidate });
  };
  pc.ontrack = e => {
    const remVideo = document.getElementById('remote-video');
    if (!remVideo.srcObject) remVideo.srcObject = e.streams[0];
    remVideo.style.display = '';
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      document.getElementById('call-status').textContent = '00:00';
      startCallTimer();
      callState = 'active';
    }
    if (['disconnected','failed','closed'].includes(pc.connectionState)) endCall(true);
  };
  return pc;
}

function openCallModal(name, avatar, color, type, statusText) {
  const modal = document.getElementById('call-modal');
  document.getElementById('call-type-label').textContent = type === 'video' ? '📹 Gọi video' : '📞 Gọi thoại';
  const ava = document.getElementById('call-ava');
  ava.textContent     = avatar;
  ava.style.background = color;
  document.getElementById('call-name').textContent   = name;
  document.getElementById('call-status').textContent = statusText;
  modal.classList.add('open');
}

function startCallTimer() {
  callSecs = 0;
  clearInterval(callTimer);
  callTimer = setInterval(() => {
    callSecs++;
    const m = Math.floor(callSecs/60).toString().padStart(2,'0');
    const s = (callSecs%60).toString().padStart(2,'0');
    document.getElementById('call-status').textContent = `${m}:${s}`;
  }, 1000);
}

function endCall(remote = false) {
  if (!remote && callPeer) socket.emit('call:end', { toId: callPeer.id });
  clearInterval(callTimer);
  if (peerConn) { peerConn.close(); peerConn = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  document.getElementById('call-modal').classList.remove('open');
  document.getElementById('video-wrap').style.display = 'none';
  document.getElementById('ctrl-cam-wrap').style.display = 'none';
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('local-video').srcObject  = null;
  const dur = callSecs > 0 ? `${Math.floor(callSecs/60)}:${(callSecs%60).toString().padStart(2,'0')}` : '';
  if (dur) showToast('📞','Cuộc gọi kết thúc',`Thời lượng ${dur}`);
  callState = null; callPeer = null; callSecs = 0;
  isMuted = false; isSpeaker = false; isCamOff = false;
  document.getElementById('ctrl-mute').classList.remove('on');
  document.getElementById('ctrl-spk').classList.remove('spk-on');
}

function showIncomingCall(name, avatar, color, type) {
  const el = document.getElementById('incoming-call');
  const ava = document.getElementById('ic-ava');
  ava.textContent     = avatar;
  ava.style.background = color;
  document.getElementById('ic-name').textContent = name;
  document.getElementById('ic-type').textContent = type === 'video' ? '📹 Gọi video' : '📞 Gọi thoại';
  el.style.display = 'flex';
  setTimeout(() => { if (el.style.display !== 'none') rejectCall(); }, 30000);
}

// Call controls
document.getElementById('ctrl-mute').onclick = () => {
  isMuted = !isMuted;
  localStream?.getAudioTracks().forEach(t => t.enabled = !isMuted);
  document.getElementById('ctrl-mute').classList.toggle('on', isMuted);
};
document.getElementById('ctrl-spk').onclick = () => {
  isSpeaker = !isSpeaker;
  document.getElementById('ctrl-spk').classList.toggle('spk-on', isSpeaker);
};
document.getElementById('ctrl-cam').onclick = () => {
  isCamOff = !isCamOff;
  localStream?.getVideoTracks().forEach(t => t.enabled = !isCamOff);
  document.getElementById('ctrl-cam').classList.toggle('on', isCamOff);
};
document.getElementById('ic-accept').onclick = acceptCall;
document.getElementById('ic-reject').onclick = rejectCall;
document.getElementById('btn-voice').onclick = () => startCall('voice');
document.getElementById('btn-video').onclick = () => startCall('video');

// ── Toast ─────────────────────────────────────────────
let _toastTimer;
function showToast(ico, title, body) {
  document.getElementById('toast-ico').textContent   = ico;
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-body').textContent  = body;
  const el = document.getElementById('toast');
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Mobile sidebar ────────────────────────────────────
document.getElementById('open-sidebar').onclick  = () => document.getElementById('sidebar').classList.add('open');
document.getElementById('close-sidebar').onclick = () => document.getElementById('sidebar').classList.remove('open');
function closeOnMobile() {
  if (window.innerWidth <= 700) document.getElementById('sidebar').classList.remove('open');
}

// ── Util ──────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
}

// DM history socket (registered after socket is created)
function onDmHistory({ toId, messages: msgs }) {
  const key = 'd:' + toId;
  messages[key] = msgs;
  if (currentRoom?.key === key) renderMessages();
}
// We hook this after socket exists — patch into setupSocketEvents
const _orig = setupSocketEvents;
// Already handled inline above with 'dm:history' in welcome flow

// Expose for HTML onclick
window.joinGroup   = joinGroup;
window.openDM      = openDM;
window.sendMsg     = sendMsg;
window.cancelReply = cancelReply;
window.setReply    = setReply;
window.react       = react;
window.showCtx     = showCtx;
window.closeCtx    = closeCtx;
window.insertEmoji = insertEmoji;
window.endCall     = endCall;
window.acceptCall  = acceptCall;
window.rejectCall  = rejectCall;
window.startCall   = startCall;
