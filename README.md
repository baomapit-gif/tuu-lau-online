# Tửu Lầu Bựa Hiệp — Online nội bộ (core only)

Bản online làm từ bản solo hiện có, KHÔNG vẽ thêm asset, KHÔNG trang trí thêm.
Tavern, nhân vật, WASD/joystick, hoạt động solo giữ nguyên. Chỉ thêm lớp online:
phòng riêng, đồng bộ vị trí, chat, admin kick/mute/đóng phòng.

## Files

- `server.js` — WebSocket server (Node + `ws`, không tốn tiền, không tài khoản).
  Vừa serve game qua HTTP, vừa chạy protocol phòng qua `/ws` cùng port.
- `tuu-lau-online.html` — bản copy của game solo + 1 hook nhỏ
  (`window.__TL_ONLINE`) + 1 panel Online. Không mở panel = chơi solo như cũ.
- `package.json` / `package-lock.json` / `node_modules/` — chỉ có dependency `ws`.

Bản gốc không bị sửa:
`workspace/your_files/quan-bar-three-js/quan-bar-three-js.html`

## Chạy local

```bash
cd workspace/game-quan-bar/online
npm install   # chỉ cần 1 lần, đã cài sẵn ws
node server.js
# -> Tuu Lau online server: http://localhost:8080/
```

Mở client:

```
http://localhost:8080/
```

Không deploy public ở đợt này, theo đúng yêu cầu.

## Luồng phòng (nội bộ, vài người)

1. Bấm nút **🛜 Online** (góc phải trên) để mở panel.
2. Nhập **Tên** + **Mã phòng** (vd: `LAU01`, chữ/số, 3–12 ký tự).
   Server mặc định trong panel là `ws://localhost:8080/ws`.
3. Bấm **Vào / Tạo phòng**.
   - Người đầu tiên vào 1 mã phòng trống = người tạo phòng = **admin**.
   - Người vào sau = khách. Chỉ người có mã phòng mới vào được.
   - Tối đa **6 người/phòng**. Tên trùng trong phòng bị từ chối.
4. Trong phòng: thấy nhân vật chibi của nhau đi lại trong quán (tên hiện
   trên đầu nhân vật), chat ở ô chat trong panel.
5. Rời phòng: bấm **Rời phòng**. Panel đóng = lại chơi solo bình thường.

## Luồng admin (Bao = người tạo phòng)

Admin là người tạo phòng, quyền được server kiểm tra (không tin client):
- **Kick:** trong danh sách người trong phòng, bấm **Kick** cạnh tên người đó.
  Người bị kick bị ngắt kết nối ngay, và không vào lại được phòng đó với
  cùng tên trong khi phòng còn tồn tại (server chặn theo tên đã bị kick).
  Lưu ý: chặn theo tên, nên đổi tên khác là 1 cách lách — đây là giới hạn
  của bản nội bộ vài người, không phải hệ thống tài khoản.
- **Mute/Unmute:** bấm **Mute** cạnh tên người đó. Người bị mute gửi chat
  sẽ bị server bỏ, không relay cho ai.
- **Đóng phòng:** bấm **Admin: Đóng phòng** (chỉ admin thấy). Mọi người
  nhận `room_closed` và bị ngắt, phòng bị xóa.
- **Admin rời phòng:** người còn lại lâu nhất tự động thành admin mới
  (server gửi `admin_promoted`), để phòng không bị kẹt không admin.
- Người không phải admin bấm kick/mute/close sẽ bị server trả lỗi
  "Chỉ admin mới..." và không có tác dụng gì.

## Đồng bộ

- Client gửi vị trí (x, z) + hướng quay (ry) tối đa 10 lần/giây, chỉ khi
  vị trí/hướng thay đổi đủ ngưỡng, kèm heartbeat 500ms. Server giới hạn
  cứng 20 move/giây/client và clamp tọa độ vào quán (x: -12..12, z: -8..8).
- Client khác lerp (nội suy) vị trí nhân vật từ xa về target mỗi frame,
  nên chuyển động mượt dù chỉ nhận 10 update/giây.
- Remote player render bằng chibi tối giản cùng tông màu với nhân vật gốc
  (áo đỏ, đầu da, tóc đen, khăn đỏ) — không asset mới, không trang trí thêm.

## Đã test thật (local, có bằng chứng chạy)

Server chạy ở port 8080/8081/8082/8083, test bằng client WebSocket `ws`
(không phải đoán):

- `ALL TESTS PASSED`: admin là người đầu tiên (admin=true), khách thứ 2
  không phải admin; move relay (guest x=3.5, z=-1.2, ry=1.0 tới được admin);
  chat relay ("hello tuu lau"); khách kick admin bị chặn; mute rồi chat
  của khách bị bỏ; admin kick ngắt kết nối khách; khách bị kick vào lại
  cùng mã phòng + cùng tên bị từ chối; admin đóng phòng, khách nhận
  `room_closed` và bị ngắt.
- `MAX TEST PASSED`: 6 người vào được, người thứ 7 bị từ chối
  "Phòng đã đủ 6 người."
- `PROMOTE TEST PASSED`: admin ngắt kết nối, khách còn lại nhận
  `admin_promoted` và kick được người mới.
- `server.js`: `node --check` OK. Script panel client: `node --check` OK.
- HTTP serve: `GET /` và `/tuu-lau-online.html` trả 200, trang chứa
  `olPanel` và tiêu đề game.

## CHƯA test — nói thẳng

- **Chưa chạy thử bằng trình duyệt thật 2 tab:** subagent không có
  trình duyệt live. Vì vậy phần render chibi từ xa + tên trên đầu, click
  panel, và broadcast WASD từ tab thật chưa được kiểm chứng bằng mắt.
  Parent cần mở 2 tab `http://localhost:8080/` (2 tên khác nhau, cùng mã
  phòng) và kiểm tra: thấy nhau đi, chat qua lại, admin kick được, trước
  khi đưa cho bạn Bao chơi.
- **Chơi solo offline chưa chạy thử bằng trình duyệt:** chỉ kiểm chứng
  bằng code — panel không mở thì không có WebSocket nào được tạo, game
  gốc chỉ thêm 1 dòng hook, nên solo không đổi. Vẫn cần 1 lần mở tab
  solo kiểm tra mắt trước khi giao.
