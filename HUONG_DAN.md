# 📱 GroupChat — Hướng dẫn cài đặt & chạy

## Yêu cầu
- Máy tính có **Node.js** (tải tại https://nodejs.org — bản LTS)
- Mạng LAN hoặc Internet để nhiều người kết nối

---

## 🚀 Cách chạy (3 bước)

### Bước 1 — Cài Node.js
Vào https://nodejs.org → Tải bản **LTS** → Cài đặt bình thường

### Bước 2 — Cài thư viện
Mở Terminal / Command Prompt, vào thư mục `groupchat-real`:
```
cd groupchat-real
npm install
```

### Bước 3 — Chạy server
```
node server.js
```
Sẽ thấy:
```
╔══════════════════════════════════════╗
║  GroupChat đang chạy tại port 3000   ║
║  Mở: http://localhost:3000           ║
╚══════════════════════════════════════╝
```

---

## 👥 Nhiều người dùng cùng lúc

### Trong cùng mạng WiFi (LAN):
1. Tìm IP máy tính đang chạy server:
   - Windows: mở CMD → gõ `ipconfig` → tìm dòng `IPv4 Address`
   - Mac/Linux: mở Terminal → gõ `ifconfig` → tìm `inet`
2. Các máy khác vào trình duyệt → nhập: `http://[IP_MÁY_SERVER]:3000`
   - Ví dụ: `http://192.168.1.5:3000`

### Qua Internet (dùng ngrok miễn phí):
1. Tải ngrok: https://ngrok.com
2. Chạy: `ngrok http 3000`
3. Dùng link `https://xxxx.ngrok.io` — gửi link cho mọi người

---

## 🎯 Tính năng

| Tính năng | Chi tiết |
|-----------|----------|
| 💬 Nhắn tin nhóm | 3 kênh có sẵn: Chung, Công Việc, Vui Lộn |
| 💌 Nhắn tin riêng | Click vào tên người dùng trong danh sách |
| 📸 Gửi ảnh | Click icon 🖼 — hỗ trợ ảnh tối đa 5MB |
| 😊 Emoji & Reaction | Bộ emoji + chuột phải vào tin nhắn |
| ↩️ Trả lời tin nhắn | Nhấn đúp chuột vào tin nhắn |
| 📞 Gọi thoại 1-1 | Cần micro — click icon 📞 |
| 📹 Gọi video 1-1 | Cần camera + micro — click icon 📹 |
| 🔔 Thông báo realtime | Có badge + popup khi có tin nhắn mới |

---

## ❓ Lỗi thường gặp

**"Cannot find module 'express'"**
→ Chưa chạy `npm install`. Chạy lại bước 2.

**Gọi điện không kết nối được**
→ Trình duyệt chặn micro/camera. Click vào icon 🔒 trên thanh địa chỉ → cho phép.

**Người khác không vào được**
→ Kiểm tra firewall: Windows → tìm "Windows Defender Firewall" → "Allow an app" → thêm Node.js

**Port 3000 đã dùng**
→ Chạy: `PORT=4000 node server.js` rồi vào http://localhost:4000
