# CKBuilder

Bài làm tuần 1 của Community Keeps Building, Builder Track. Repo gồm ứng dụng luyện tập trên Devnet local, một hợp đồng hello-world, và ảnh bằng chứng cho từng bài.

Mọi giao dịch trong báo cáo chạy trên **OffCKB Devnet** tại máy local. Không dùng mainnet và không chứa private key.

## Bố cục

```text
CKBuilder/
├── ckb-learning-lab/     Ứng dụng web: chuyển CKB, token, DOB, Lock Script
├── hello-world/          Hợp đồng JavaScript mẫu, in "Hello, World!"
├── reports/
│   └── week01/           Báo cáo tuần 1 và ảnh bằng chứng
└── README.md             File này
```

## `ckb-learning-lab/`

Giao diện tại http://localhost:2507. Backend là Express và TypeScript. Trình duyệt dùng HTML, CSS và JavaScript thuần. Thư viện `@ckb-ccc/core` dựng và ký giao dịch.

| File | Việc nó làm |
|---|---|
| `src/server.ts` | Mở server ở `127.0.0.1:2507`, phục vụ trang web và các API |
| `src/ckb/client.ts` | Kết nối RPC Devnet |
| `src/ckb/signer.ts` | Ký bằng khóa Account #0 nằm ngoài repo |
| `src/ckb/token.ts` | Dựng giao dịch sUDT |
| `src/ckb/dob.ts` | Dựng Cell đối tượng số dùng TYPE_ID |
| `src/ckb/lock-script.ts` | Đọc lock secp256k1 và dựng giao dịch tạo hoặc chi Cell |
| `src/modules/` | Quy tắc từng bài: lưu lịch sử, chống gửi trùng |
| `src/routes/` | Đường dẫn HTTP cho DOB và Lock Script |
| `public/index.html` | Các tab của trang |
| `public/app.js` | Tab token, ví và kết nối Devnet |
| `public/dob.js` | Tab Digital Object |
| `public/lock-script.js` | Tab Lock Script |
| `public/style.css` | Bố cục trang, mỗi bước một hàng |
| `tests/` | Kiểm tra offline, không gửi giao dịch |

Chi tiết lệnh chạy và giới hạn của từng module nằm trong [`ckb-learning-lab/README.md`](ckb-learning-lab/README.md).

Chạy khi Devnet đã bật:

```bash
cd ckb-learning-lab
npm ci
npm run dev
```

RPC của node là http://127.0.0.1:8114. Ứng dụng chỉ lắng nghe trên máy local.

## `hello-world/`

Project hợp đồng tạo bằng `offckb create`. File hợp đồng là `contracts/hello-world/src/index.ts`. Nó nạp script, ghi log `Hello, World!`, rồi trả về `0`.

| File | Việc nó làm |
|---|---|
| `contracts/hello-world/src/index.ts` | Mã hợp đồng |
| `scripts/build-contract.js` | Đóng gói TypeScript rồi biên dịch ra bytecode |
| `dist/hello-world.bc` | Bytecode sau khi build. Thư mục này chỉ có sau `npm run build` |
| `tests/hello-world.mock.test.ts` | Chạy hợp đồng bằng debugger WebAssembly, không cần node |
| `tests/hello-world.devnet.test.ts` | Gửi giao dịch lên Devnet sau khi deploy |

```bash
cd hello-world
npm install
npm run build
npx jest tests/hello-world.mock.test.ts
```

Build cần lệnh `ckb-debugger` có trên `PATH`.

## `reports/week01/`

[`weekly_report.md`](reports/week01/weekly_report.md) là báo cáo tuần. Các thư mục con chỉ chứa ảnh chụp màn hình, đánh số theo thứ tự thao tác. Hash và số block trong báo cáo lấy từ những ảnh này.

| Thư mục | Bài | Ảnh chính |
|---|---|---|
| [`01_environment/`](reports/week01/01_environment/) | Cài môi trường | Phiên bản Ubuntu, Node, npm, Git, OffCKB, node Devnet và danh sách account |
| [`02_ckb_transfer/`](reports/week01/02_ckb_transfer/) | Chuyển 100 CKB | Số dư trước và sau, giao dịch committed ở block 87 |
| [`03_cell_data/`](reports/week01/03_cell_data/) | Ghi dữ liệu vào Cell | Script `src/store-data.ts` và `src/send-transaction.ts`, ảnh mã hóa `Hello CKB!` và giao dịch committed ở block 799 |
| [`04_fungible_token/`](reports/week01/04_fungible_token/) | Token CKBT | Tạo 1000 CKBT, số dư 980, hai lần chuyển 10 CKBT và một lần chuyển 15 CKBT đã committed |
| [`05_dob/`](reports/week01/05_dob/) | Đối tượng số | Tạo và chuyển Cell TYPE_ID. Không phải chuẩn Spore. Giải thích giao thức nằm trong [`05_dob/README.md`](reports/week01/05_dob/README.md) |
| [`06_lock_script/`](reports/week01/06_lock_script/) | Lock Script | Lock secp256k1 có sẵn. Ảnh tạo Cell, chi tiêu sai khóa bị lỗi `-31`, và chi tiêu đúng khóa đã committed. Giải thích nằm trong [`06_lock_script/README.md`](reports/week01/06_lock_script/README.md) |

`03_cell_data/` còn là một project Node nhỏ, tách khỏi Learning Lab. Hai file TypeScript trong `src/` dùng để nối Devnet, mã hóa chuỗi và gửi Cell chứa dữ liệu.
