# Week 01 — 05: Digital Object (DOB)

Triển khai module DOB trong **CKB Learning Lab** hiện có, tại `http://localhost:2507`. Mục tiêu: tạo một đối tượng số bằng giao dịch CKB thật, đọc dữ liệu và chủ sở hữu từ Cell còn sống, chuyển đối tượng từ Account #0 đến Account #1, rồi kiểm tra giao dịch và Cell.

**Trạng thái: mã đã triển khai và kiểm tra tĩnh/unit offline; người dùng chưa kiểm thử ứng dụng hoặc giao dịch DOB trên Devnet. Không có hash giao dịch DOB hay ảnh bằng chứng được tạo trong quá trình triển khai.**

## 1. Lựa chọn giao thức

Đã kiểm tra source Learning Lab, báo cáo Week 01, thư mục `quickstart`, dự án `hello-world`, các package đang cài và CLI OffCKB. Repo không có đặc tả văn bản yêu cầu Spore cho bài 05; DOB trước đó là tab placeholder. `04_fungible_token` có ảnh và mục báo cáo tuần; đường dẫn README bài 04 được README cũ dẫn tới hiện không tồn tại.

Môi trường đã kiểm tra bằng lệnh chỉ đọc cấu hình/help:

- OffCKB **0.4.13**: `offckb --version`.
- CCC **1.23.0**: package cài tại `ckb-learning-lab/node_modules/@ckb-ccc/core`.
- `offckb system-scripts --network devnet --export-style ccc` xuất **TypeId**, cấu hình secp256k1 và Cell dependency thực tế. Không dùng hash/deployment trên testnet để thay cho Devnet.
- CCC có `hashTypeId`, tự tính occupied capacity và các hàm hoàn thiện input/fee.
- Không thêm dependency, không triển khai contract.

Lựa chọn: **đối tượng Cell tùy chỉnh + TYPE_ID**, mã định dạng `ckbuilder-type-id-v1`. **Đây không phải Spore DOB**, không tương thích bộ decoder/cluster/SDK Spore. Không có cam kết về yêu cầu khác nằm ngoài tài liệu có sẵn trong repo.

TYPE_ID được CKB tích hợp sẵn, không cần Cell dep cho chính TYPE_ID. Ứng dụng vẫn kiểm tra cấu hình TYPE_ID từ OffCKB và dependency ký secp256k1 còn sống trước khi dựng giao dịch. Định danh được tính bằng CCC từ `inputs[0]` thực tế và output index 0; không dùng chuỗi ngẫu nhiên giả làm định danh on-chain.

Tài liệu nền tảng: [Nervos RFC 0022 — TYPE_ID và transaction structure](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md), [Nervos RFC 0024 — built-in TYPE_ID](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0024-ckb-genesis-script-list/0024-ckb-genesis-script-list.md). API được đối chiếu trực tiếp với source CCC đã cài, đặc biệt `src/ckb/hash.ts`, `src/ckb/transaction.ts`, `src/signer/ckb/signerCkbPublicKey.ts` và `src/client/jsonRpc/client.ts`.

## 2. Định dạng và mô hình sở hữu

Một đối tượng tương ứng tối đa một live Cell với type script TYPE_ID:

- **Object ID** trong ứng dụng là `type.args` dài 32 byte; không phải hash transaction hay toàn bộ type script hash.
- **Owner** là địa chỉ biểu diễn lock script của live Cell, được tính bằng CCC.
- `Cell.output_data` chứa UTF-8 JSON gồm `protocol`, `version`, `name`, `description`, `contentType`, `content`. Tất cả bốn trường người dùng nhập đều được lưu trên chain.
- Name tối đa 128 byte, description 512 byte, content 1536 byte UTF-8; toàn bộ JSON sau escaping tối đa 4096 byte, được kiểm tra trước khi ký/lưu. Description có thể rỗng; name/content không được rỗng. Hỗ trợ `text/*` và `application/json`; JSON phải hợp lệ. Nội dung được render bằng `textContent`, không thực thi HTML/JavaScript.
- Capacity được CCC tính theo byte của capacity field, lock, type và toàn bộ dữ liệu; dùng bigint/shannon, không dùng số thực ước lượng. Phí đặt ở 1000 shannon/1000 byte, có Cell trả lại CKB thừa.
- Transfer tiêu thụ Cell cũ, tạo Cell mới cùng TYPE_ID và **đúng các byte dữ liệu cũ**, thay lock sang receiver. Capacity của đối tượng được giữ, hoặc tăng đủ occupied minimum nếu lock receiver dài hơn; chủ hiện tại chi trả phần tăng/phí bằng plain Cells.

TYPE_ID bảo đảm tính duy nhất của định danh và yêu cầu tiêu thụ Cell cũ để tiếp tục định danh đó. **TYPE_ID không khóa nội dung bất biến và cho phép hủy Cell.** Chủ sở hữu dùng công cụ ngoài ứng dụng có thể sửa dữ liệu hoặc burn đối tượng. Learning Lab so sánh byte dữ liệu live với dữ liệu tạo đã lưu và từ chối transfer nếu thay đổi. Muốn bất biến được consensus thực thi cần một type contract riêng hoặc một giao thức thích hợp như Spore; module này không đưa ra bảo đảm đó.

## 3. Kiến trúc

| Thành phần | Trách nhiệm |
| --- | --- |
| `src/routes/dob.ts` | Express router, thứ tự route cố định trước `/:id` |
| `src/modules/dob-data.ts` | Validate body, MIME, UTF-8, ID, request key và encode/decode |
| `src/ckb/dob.ts` | Script/dependency, tìm live Cell, signer, dựng giao dịch, inspect RPC |
| `src/modules/dob.ts` | Workflows, journal, idempotency, đối chiếu creation và trạng thái |
| `src/modules/transaction-guard.ts` | Khóa dựng giao dịch dùng chung với sUDT; chặn dùng chung funding khi module kia còn pending/unknown |
| `public/dob.js` | Giao diện Vanilla JS, gọi API, retry có cùng key, polling chỉ đọc |
| `data/dob-config.json` | Journal cục bộ tự tạo khi có POST thành công tới bước ký/lưu |

Tái sử dụng connection panel, API wallet, hai account thực từ `offckb accounts`, CCC client và key Account #0 hiện có. Account panel được đưa ra ngoài riêng tab token để dùng chung. Module sUDT giữ workflow hiện có; thay đổi backend liên quan là khóa dựng giao dịch dùng chung và kiểm tra journal DOB trước giao dịch token mới.

Backend bind `127.0.0.1:2507`, kiểm tra Host, địa chỉ socket loopback, Origin khớp Host và `Sec-Fetch-Site` cho POST. Yêu cầu `application/json`, không CORS cho nguồn bên ngoài. Body token vẫn giới hạn 4 KB; body DOB 24 KB để chứa JSON escaping, còn dữ liệu từng trường có giới hạn byte riêng. Không nhận khóa riêng, RPC URL, transaction tùy ý hoặc lệnh shell từ trình duyệt. Không trả lỗi SDK nội bộ, key hay signed bytes qua API.

Chỉ chạy **một process Learning Lab** với cùng thư mục dữ liệu; khóa là in-process, không hỗ trợ nhiều worker/process ký song song.

## 4. API

| Method | Route | Mục đích |
| --- | --- | --- |
| GET | `/api/dob/info` | Giao thức, scripts thực, lịch sử public |
| GET | `/api/dob/objects` | Danh sách các ID đã lưu, dữ liệu và owner được kiểm tra từ chain |
| POST | `/api/dob/create` | `{name, description, contentType, content}` |
| GET | `/api/dob/:id` | Live object, owner, Cell, creation reference, nguồn dữ liệu |
| POST | `/api/dob/transfer` | `{objectId, receiver}` |
| GET | `/api/dob/transaction/:hash` | Trạng thái RPC, block, inputs, outputs, scripts, dependencies |

Mọi POST yêu cầu `Idempotency-Key` gồm 8–100 chữ ASCII/chữ số/`_`/`-`. Frontend tạo và giữ key theo ý định gửi, kể cả sau timeout/reload. Key cũ với payload khác bị từ chối.

## 5. Create → View → Transfer → Verify

**Create:** xác thực form → kiểm tra các giao dịch trước đã kết thúc và dependency → lấy signer Account #0, xác minh khớp địa chỉ OffCKB → tạo output với TYPE_ID args có đúng kích thước → chọn plain funding Cells → tính TYPE_ID từ input/output thật → hoàn thiện fee/change và dependency ký → ký → kiểm tra input live → lưu journal atomically, fsync trước broadcast → gửi transaction bằng CCC. TYPE_ID là custom output nên dùng output validator `passthrough`; consensus vẫn xác thực toàn bộ script. Không tạo đối tượng khi startup/GET/refresh.

Mọi ID đã có trong journal, kể cả creation bị từ chối, đều được giữ chỗ. Nếu input đầu còn sống từ một creation thất bại có thể sinh lại ID cũ, builder đổi input đầu sang funding input khác hoặc thêm một plain Cell mới. Không có input phù hợp thì báo `NO_FRESH_TYPE_ID_INPUT` trước khi ghi/gửi; cần cấp một plain Cell mới cho Account #0. Service cũng chặn trùng ID lần cuối trước khi lưu để bảo toàn journal.

**View:** dựng type script từ ID và cấu hình TYPE_ID local → kiểm tra indexer theo kịp tip → truy vấn exact type → kiểm tra live Cell không dùng cache → xác nhận transaction tạo ra Cell hiện tại đã committed → giải mã dữ liệu và lock on-chain. Creation hash lấy từ journal và được đối chiếu output của transaction khi committed. Không dùng owner trong metadata cục bộ làm bằng chứng.

**Transfer:** yêu cầu creation đã committed và còn creation record → đọc lại live Cell mới nhất → kiểm tra dữ liệu không thay đổi → chọn key được phép ứng với owner thực → validate receiver và từ chối gửi lại chính owner → dùng Cell cũ làm input, giữ type/data → thêm funding/phí và ký → kiểm tra lại liveness → lưu trước broadcast → đợi RPC committed rồi đọc lại live Cell để hiển thị owner mới.

**Verify:** Inspect hiển thị hash đầy đủ, operation, sender/receiver yêu cầu, trạng thái và block. Inputs/outputs, raw data, lock/type và deps nằm trong mục mở rộng. Current owner trong history lấy từ live object, không lấy trực tiếp từ receiver yêu cầu của giao dịch đang pending.

Trạng thái `pending`/`proposed` chưa chứng minh thay đổi sở hữu. Chỉ `committed` do RPC trả về được coi là xác nhận. `rejected` thể hiện node từ chối, lỗi script verification đã lưu, hoặc kết luận cục bộ rằng giao dịch không thể commit vì **một transaction khác đã committed và tiêu thụ đúng input đó**; reason phân biệt rõ và lưu `conflictTxHash`. Timeout hoặc transaction không tìm thấy là `unknown`, không tự gán thành công/thất bại. `no_live_cell` nghĩa là creation đã committed nhưng hiện không tìm thấy live Cell; không tự kết luận burn vì có thể do chain/indexer thay đổi.

## 6. Persistence và retry

Journal nằm ở `ckb-learning-lab/data/dob-config.json` (được `.gitignore` bỏ qua), chỉ ghi khi chuẩn bị một giao dịch từ POST rõ ràng. Lưu protocol, genesis, IDs, creation hashes, nội dung public và lịch sử operation. Signed transaction bytes được giữ để retry chính xác; chúng chứa chữ ký, **không chứa private key**, và không được trả ra API. File tạo với quyền `0600`, ghi tạm + fsync + rename.

Sau restart, ứng dụng đọc và kiểm tra format journal, hash của signed bytes, ID/output/data, genesis và creation record; owner tiếp tục phải đọc từ blockchain. Journal hỏng hay chain khác sẽ bị từ chối, không ghi đè. Nếu Devnet được reset với cùng genesis, genesis đơn thuần không phát hiện reset; các transaction/liveness checks vẫn không cho dùng record cũ như bằng chứng sở hữu. Không reset Devnet hoặc xóa journal để retry.

**Retry same submission** chỉ gửi lại cùng signed transaction nếu RPC trả `unknown` và input vẫn live. Nếu đã pending/proposed/committed/rejected thì trả trạng thái đã biết, không dựng transaction thay thế. Frontend giữ request key đến trạng thái cuối và có thể khôi phục payload/key của operation chưa kết thúc từ journal sau khi mất session. GET, polling và startup không bao giờ broadcast. Pending/unknown chặn giao dịch mới có thể dùng chung funding với token. Mỗi builder mới xóa cache funding của CCC để không dùng change Cell đã bị công cụ ngoài tiêu thụ.

Nếu unknown có input mất liveness, POST retry tra tối đa 4 trang × 50 transaction gần nhất theo lock từ indexer để tìm **giao dịch khác đã committed tiêu thụ đúng outpoint**. Chỉ khi có bằng chứng này mới lưu trạng thái cuối rejected/conflict; kiểm tra lại hash gốc trước khi kết luận. Không tìm thấy bằng chứng trong giới hạn đó thì vẫn fail closed, cần kiểm tra node/chain và journal bằng tay. Không coi một Cell mất liveness đơn thuần là rejection; không tự xóa lịch sử hoặc tạo giao dịch mới thay thế.

ID có live Cell hợp lệ nhưng không có journal vẫn có thể View; creation hash hiển thị không biết và transfer trong lab bị khóa. Khôi phục journal đã sao lưu để lấy đầy đủ lịch sử/tính năng; module không có chức năng tự quét và khôi phục lịch sử creation từ mọi giao dịch trên chain.

## 7. Lệnh chạy thủ công

Không có deployment/setup contract thêm. Giữ nguyên Devnet hiện tại và key Account #0 có sẵn ở `~/.config/offckb/devnet-account-0.key`. Không cần key Account #1 để chuyển **đến** Account #1.

Terminal 1 — nếu Devnet chưa chạy:

```bash
offckb node
```

Nếu đã chạy, tiếp tục dùng process đó; không clean/reset/restart chain. Có thể tự chọn chế độ daemon bằng `offckb node --daemon` nếu muốn.

Terminal 2 — Learning Lab:

```bash
cd /home/sotatek/toan/code/CKBuilder/ckb-learning-lab
npm run dev
```

Dependencies hiện đã có. Nếu clone sang môi trường khác, chạy `npm ci` trước `npm run dev`. Mở **http://localhost:2507**.

Kiểm tra tĩnh/unit không khởi động dịch vụ và không gửi giao dịch:

```bash
cd /home/sotatek/toan/code/CKBuilder/ckb-learning-lab
npm run typecheck
npm run test:unit
node --check public/app.js
node --check public/dob.js
```

`npm test` còn chứa bộ HTTP integration cũ của token, có thể truy cập server đã chạy. Quá trình triển khai bài 05 chỉ chạy `test:unit`, không chạy bộ runtime này.

Tùy chọn, **chỉ nếu cần chuyển tiếp từ Account #1**: backend hỗ trợ key `~/.config/offckb/devnet-account-1.key`. Người dùng tự xem khóa dev tích hợp bằng `offckb accounts --show-private-keys`, lưu đúng khóa #1 bằng editor local vào file đó, rồi đặt `chmod 600 ~/.config/offckb/devnet-account-1.key`. Không đặt khóa trong source, browser hoặc ảnh bằng chứng. Backend xác minh key khớp lock owner trước khi ký. Không có key của owner khác thì chỉ xem được đối tượng.

## 8. Checklist kiểm thử do người dùng thực hiện

- [ ] Refresh: connection connected, RPC đúng, block tăng; địa chỉ #0/#1 lấy từ cấu hình thực.
- [ ] Chuyển qua lại các tab; Fungible Token còn metadata, history và balances trước đó. Kiểm tra workflow token riêng nếu cần; không tự mint lại token cũ.
- [ ] Mở DOB; script info cho thấy TYPE_ID built-in và secp dependency, không cần Deploy.
- [ ] Create với dữ liệu mặc định; ghi lại Object ID và hash thật từ UI. Không click lại bằng key mới khi trạng thái chưa rõ.
- [ ] Đợi history/Inspect báo committed và có block; không coi pending là thành công.
- [ ] View ID: name/description/content type/content khớp, owner là Account #0, Cell có type và dữ liệu thật; kiểm tra capacity và raw data trong phần mở rộng.
- [ ] Transfer object đến Account #1 được điền từ danh sách account; ghi hash mới và đợi committed.
- [ ] View lại: Object ID/type/data giữ nguyên; owner khớp Account #1, outpoint mới. Nếu indexer đang đồng bộ, đợi rồi Refresh.
- [ ] Inspect transfer: input chứa outpoint cũ, output khóa receiver; không có output copy thứ hai cùng TYPE_ID.
- [ ] Copy hash hoạt động, lỗi nhập liệu rõ ràng, nút gửi khóa khi xử lý/pending.
- [ ] Restart riêng Learning Lab bằng Ctrl+C rồi `npm run dev`; View ID cũ/history/new owner vẫn đọc được từ journal + chain, không có giao dịch mới tự sinh.
- [ ] Nếu timeout, dùng Retry same submission; kiểm tra chỉ có đúng hash/operation đã lưu.
- [ ] Tự chụp ảnh connection/accounts, create committed, nội dung on-chain, transfer committed, owner mới và Inspect khi đã kiểm thử xong.

## 9. Kết quả mong đợi và giới hạn

Sau một lần Create và một lần Transfer thành công trên Devnet: một định danh, một live Cell hiện tại của Account #1, hai operation trong journal, hai hash thật ở trạng thái committed. Capacity trả phí bằng CKB, khác nội dung của đối tượng. Đây là **kết quả mong đợi**, chưa phải kết quả đã đo trên chain.

Giới hạn: custom format không phải Spore; không hỗ trợ cluster/decoder/binary media; không bảo đảm bất biến dữ liệu bằng contract; transfer yêu cầu journal và key chủ hiện tại; journal không phục hồi tự động nếu mất; một process backend; cần node/indexer đang đồng bộ. Các bảo đảm finality/reorg dài hạn, nhiều client hoặc môi trường production nằm ngoài phạm vi lab local. Các tab CKB Transfer/Cell Data/Lock Script vốn là placeholder trong DApp hiện tại; source và bằng chứng bài trước ở `reports/` vẫn giữ nguyên.

## 10. Trạng thái xác minh

- TypeScript: đã qua `npm run typecheck`.
- Cú pháp frontend: đã qua `node --check` cho `app.js` và `dob.js`.
- Unit offline: **97 tests passed, 0 failed, 0 skipped**, gồm test DOB và amount/validation sUDT; test DOB dùng fixture, chặn network/broadcast, không ký bằng key của người dùng.
- Runtime/UI, node acceptance, giao dịch Create/Transfer thật: **chưa thực hiện**; người dùng tự kiểm thử.
- Khởi động server/OffCKB trong quá trình triển khai: **không**.
- Deployment/broadcast trong quá trình triển khai: **không**.
- Ảnh chụp màn hình: **chưa chụp, không tạo file ảnh**, không thay đổi ảnh bài trước.
