# Week 01 / 06 — Lock Script

## Phạm vi và quyết định về contract

Module nằm trong ứng dụng có sẵn `ckb-learning-lab`, tab **Lock Script**, dùng CCC `@ckb-ccc/core` 1.23.0 đang cài, Express/TypeScript và HTML/CSS/JavaScript. Không thêm framework hoặc dependency.

Đã kiểm tra source, README, `reports/`, weekly report, `hello-world/contracts/`, các tài liệu dạng văn bản và năm ảnh có sẵn trong `quickstart/`. Không tìm thấy đề bài `06_lock_script` độc lập hoặc yêu cầu viết/deploy custom Lock Script. Tab hiện hữu chỉ ghi “Learn CKB Cell locking conditions.” `hello-world` là ví dụ ckb-js-vm trả về thành công, không phải contract xác thực ownership và không được dùng để bảo vệ Cell trong bài này. Ảnh `quickstart/` ghi lại các lệnh thiết lập Node/OffCKB/accounts và thao tác lịch sử, không chứa đề bài Lock Script; không thực hiện lại các lệnh trong ảnh.

Vì vậy triển khai bài học bằng **standard `secp256k1_blake160_sighash_all`**, được lấy từ export OffCKB Devnet hiện tại. Đây là quyết định theo thông tin đang có, không phải xác nhận về một đề bài bên ngoài repository. Nếu giáo trình riêng yêu cầu custom lock, phần viết contract, kiểm thử VM và deployment của contract đó vẫn là công việc bổ sung; module này không được trình bày như một custom contract.

**Không cần deploy contract mới.** Backend kiểm tra live Cell dependency, giải mã `depGroup`, kiểm tra các member còn sống và đối chiếu code hash với deployment. Không lấy deployment public testnet thay cho Devnet.

## Lock Script hoạt động thế nào

Mỗi Cell output có `capacity`, `lock`, `type` tùy chọn và dữ liệu riêng. Lock quy định điều kiện để giao dịch mới tiêu Cell làm input. Trong bài học, Account #0 là owner; chữ ký nằm trong `WitnessArgs.lock` của giao dịch tiêu Cell.

Script gồm:

| Trường | Ý nghĩa |
| --- | --- |
| `codeHash` | Hash xác định chương trình được thực thi; backend đối chiếu với live deployment |
| `hashType` | Cách tìm chương trình: theo hash dữ liệu hoặc hash type script của code Cell |
| `args` | Với standard lock này: Blake160 của compressed public key của owner, dài 20 byte |
| Script hash | Hash của Script được serialize bằng Molecule, bao gồm code hash, hash type và args |
| Cell deps | Outpoints đến code/data Cell hoặc dep group cần cho script verification |

Script hash không phải transaction hash và không phải code hash. Địa chỉ là cách mã hóa lock theo network; bước Inspect giải mã địa chỉ #0 từ OffCKB, hiển thị toàn bộ script và tính script hash bằng CCC.

Standard lock khôi phục public key từ chữ ký recoverable của transaction sighash, hash public key rồi so sánh với `args`. Cách tính sighash bao gồm raw transaction hash và các witness của lock group theo quy tắc sighash-all; không dùng API ký thông điệp văn bản có prefix để thay cho chữ ký giao dịch. Tham khảo [source standard lock chính thức](https://github.com/nervosnetwork/ckb-system-scripts/blob/master/c/secp256k1_blake160_sighash_all.c).

## Luồng 5 bước

### 1. Inspect Lock Script

`GET /api/lock-script/info` đọc genesis, địa chỉ #0/#1, cấu hình script đã export từ OffCKB, live dependencies và transaction history. UI hiển thị địa chỉ #0, code hash, hash type, args, script hash, minimum capacity, fee rate và deployment members. Các GET/refresh/polling không ký hoặc gửi giao dịch.

### 2. Create Locked Cell

Chọn Account #0, nhập capacity dạng chuỗi thập phân CKB, tối đa 8 chữ số phần lẻ. Backend kiểm tra uint64 Shannon, owner cố định và occupied capacity.

Output 0 có lock của #0, không có type script, dữ liệu **`0x4c`**. Marker một byte giúp các collector funding trống hiện tại của Token/DOB bỏ qua Cell bài học. Marker chỉ là quy ước ứng dụng; nó không tạo thêm điều kiện xác thực trong contract.

Với lock args 20 byte, minimum là **62 CKB**: capacity field 8 byte + code hash 32 + hash type 1 + args 20 + data 1. Output thông thường dữ liệu rỗng ở bước Spend có minimum 61 CKB. Code tính từ `occupiedSize` và số byte dữ liệu thực tế, không hardcode mức 61 cho mọi Cell.

CCC chọn plain funding Cells của #0, thêm change và phí **1000 Shannon / 1000 byte**. Backend xác minh key khớp địa chỉ #0, kiểm tra liveness từng input rồi ký. Signed bytes, hash tính thật và request key được lưu trước khi broadcast. Chỉ Cell của giao dịch **committed** và còn **live** mới xuất hiện trong bộ chọn Step 3.

### 3. Test Unauthorized Spending

Chỉ nhận outpoint output 0 đã được module ghi nhận. Backend kiểm tra creation committed, Cell còn live, lock đúng #0, không có type và marker đúng.

Quy trình:

1. Dựng giao dịch một input là Cell đã chọn, output đến Account #1, trừ phí bằng CCC.
2. Ký bằng #0 và chạy `estimate_cycles` làm **đối chứng thành công**. Nếu đối chứng lỗi, bài kiểm tra không được tính là đạt.
3. Clone giao dịch, đưa witness lock về placeholder 65 byte, tính đúng sighash của owner lock group.
4. Ký sighash đó bằng key #1 nếu backend có file phù hợp; nếu thiếu thì tạo key ngẫu nhiên chỉ tồn tại trong bộ nhớ backend, ghi rõ nhãn trên UI. Không cần cấp CKB cho key trái phép.
5. Đặt chữ ký recoverable 65 byte vào đúng witness của lock #0. Xác minh chữ ký bằng public key trái phép và đối chiếu public key khôi phục: chữ ký hợp lệ nhưng Blake160 khác `args` owner.
6. Chạy `estimate_cycles` cho giao dịch đó. Chỉ lỗi RPC `-302`, `ValidationFailure`, error code **`-31`** ở đúng **`Inputs[n].Lock`** được tính là từ chối ownership mong đợi.
7. Kiểm tra lại Cell vẫn live; lưu thời điểm, signer công khai, sighash, chữ ký, public key khôi phục, actual error và kết quả.

**Không gọi `send_transaction` trong bước này.** Lỗi thiếu dependency, RPC offline, method không hỗ trợ, witness sai hoặc chữ ký thiếu đều không phải bằng chứng xác thực quyền. UI ghi “inconclusive” nếu lỗi trả về không khớp. Key không được trả về trình duyệt hoặc lưu trong journal.

`estimate_cycles` thực thi lock/type scripts nhưng không phải full transaction/pool validation; đối chứng ký đúng chỉ chứng minh script execution thành công. Phí/capacity/input của giao dịch vẫn được dựng và kiểm tra riêng. Xem [CKB RPC chính thức](https://github.com/nervosnetwork/ckb/blob/develop/rpc/README.md#chain-estimate_cycles).

### 4. Authorized Spending

Sau khi có kết quả Step 3 đạt cho đúng outpoint, chọn destination standard Secp256k1 Devnet, mặc định #1. Backend dựng giao dịch mới dùng **duy nhất Cell đã chọn** làm input, output 0 dữ liệu rỗng đến destination. Toàn bộ capacity trừ phí được chuyển đến output đó; không lấy thêm Cell của #1 hoặc funding khác.

Account #0 ký, backend kiểm tra liveness trước khi gửi, persist signed bytes rồi broadcast. UI hiển thị input outpoint, destination, hash, output index, status và block khi đã committed. Step 3 không tiêu Cell; Step 4 mới tiêu nó sau khi được người dùng bấm gửi.

### 5. Transaction Verification

Inspect dùng `get_transaction`, `get_header` và `get_live_cell` mới từ node, kiểm tra cả signed bytes (bao gồm witness) khớp journal. Kết quả gồm:

- Giao dịch authorized đã committed và có block number thực tế.
- Giao dịch đó tiêu đúng original outpoint; creation committed, original lock #0 và marker được đối chiếu.
- Original Cell không còn live, có bằng chứng chính giao dịch committed đã tiêu nó.
- Output 0 tồn tại trong giao dịch committed và còn live tại thời điểm kiểm tra.
- Lock của Cell tạo ban đầu/input spend đúng standard lock của #0; lock output spend đúng destination đã ký.
- Bài kiểm tra trái phép trên cùng Cell đã thất bại đúng nguyên nhân, chữ ký hợp lệ và Cell còn live sau bài kiểm tra.

CKB hiện đại có thể trả `unknown` cho Cell đã tiêu vì `dead` đã deprecated. Module giữ nguyên raw status; chỉ kết hợp `unknown` với giao dịch committed khớp signed bytes và tiêu đúng outpoint mới kết luận Cell đã bị tiêu. `unknown` riêng lẻ không đủ bằng chứng. Lịch sử giữ nút **Inspect** cho từng funding/spend, có form inspect hash và JSON inputs/outputs/dependencies.

## Backend, API và chống gửi trùng

| Endpoint | Body JSON |
| --- | --- |
| `GET /api/lock-script/info` | Không có |
| `POST /api/lock-script/create` | `{"ownerAccount":0,"capacity":"100"}` |
| `POST /api/lock-script/test-unauthorized` | `{"outPoint":{"txHash":"<hash creation thật>","index":0}}` |
| `POST /api/lock-script/spend` | `{"outPoint":{"txHash":"<hash creation thật>","index":0},"receiver":"<địa chỉ ckt1 thật>"}` |
| `GET /api/lock-script/transaction/:hash` | Không có |

Mọi POST cần `Content-Type: application/json`, `Origin` khớp Host local, kết nối loopback và `Idempotency-Key` 8–100 ký tự chữ/số/`_`/`-`. Host chỉ cho phép `localhost:2507` hoặc `127.0.0.1:2507`. Guard dùng lại từ server hiện hữu; server bind `127.0.0.1`. Không nhận private key, signed transaction, URL RPC hoặc shell command từ browser.

`data/lock-script-config.json` được tạo khi người dùng thực hiện action đầu tiên. Journal ghi atomic với mode `0600`, kiểm tra schema, genesis, hash và liên hệ giữa create/test/spend. Cùng request key + cùng payload trả lại operation/test đã lưu; cùng key + payload khác trả `409 IDEMPOTENCY_CONFLICT`. UI giữ intent trong sessionStorage khi chưa biết kết quả, có **Retry same submission**. Chỉ POST retry rõ ràng có thể gửi lại đúng signed bytes đã lưu khi node chưa biết hash. GET không rebroadcast.

Token, DOB và Lock Script chia sẻ mutex trong process và kiểm tra journal của các module khác trước khi dùng chung funding. Pending/proposed/unknown chặn operation mới; rejected cho phép thao tác tiếp. Nếu node mất transaction, chỉ xác nhận bị loại do conflict khi tìm thấy giao dịch khác **đã committed** tiêu input đó. Lỗi transport/pool không tự được gọi là rejected. Khi rejected ở script verification, lưu lý do; khi kết quả chưa rõ, giữ hash và signed bytes để người dùng Inspect/retry.

## Lệnh do người dùng tự chạy

Các lệnh dưới đây là hướng dẫn thủ công. Trong lượt triển khai này agent **không chạy node, server, deploy, broadcast, reset hoặc chụp ảnh**.

Kiểm tra offline trong thư mục ứng dụng:

```bash
cd /home/sotatek/toan/code/CKBuilder/ckb-learning-lab
npm run typecheck
npm run test:unit
node --check public/lock-script.js
```

Dependencies đã có trong workspace. Nếu dùng checkout mới, chạy `npm ci` trước. Không dùng `npm test` nếu chỉ muốn kiểm tra offline: script đó còn gồm `tests/api.test.ts` cần server hiện có.

Nếu Devnet hiện tại chưa chạy, tự chạy trong terminal riêng, giữ nguyên dữ liệu cũ:

```bash
offckb node
```

Nếu đã có node ở `127.0.0.1:8114`, dùng node đó. Không cần reset/redeploy/reinitialize. Backend cần key #0 đã có tại `~/.config/offckb/devnet-account-0.key`, tương ứng đúng OffCKB account hiện tại. Có thể đặt quyền file bằng:

```bash
chmod 600 ~/.config/offckb/devnet-account-0.key
```

Key #1 là tùy chọn. Nếu muốn hiển thị đúng “Account #1” trong Step 3, tự lưu key dev #1 đúng vào `~/.config/offckb/devnet-account-1.key` bằng editor local và đặt mode `600`. Nếu không có file, vẫn thực hiện được bằng key trái phép tạm thời. Không gửi key qua API hoặc đưa key vào báo cáo/source.

Chạy hoặc restart riêng ứng dụng sau khi cập nhật code:

```bash
cd /home/sotatek/toan/code/CKBuilder/ckb-learning-lab
npm run dev
```

Mở **http://localhost:2507**, chọn tab **Lock Script**. Đọc API thủ công:

```bash
curl --fail-with-body http://localhost:2507/api/lock-script/info
```

Ví dụ POST dưới đây **sẽ gửi funding transaction thật trên Devnet khi bạn tự chạy**. Không chạy lại bằng key mới chỉ vì response chậm; dùng key/body gốc để khôi phục. Chọn request key mới cho mỗi lần tạo Cell có chủ đích:

```bash
curl --fail-with-body http://localhost:2507/api/lock-script/create \
  -H 'Origin: http://localhost:2507' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: lock-manual-create-001' \
  --data '{"ownerAccount":0,"capacity":"100"}'
```

Các placeholder `<hash creation thật>`/`<địa chỉ ckt1 thật>` trong bảng API chỉ là mô tả schema. Sao chép hash/address từ response thật hoặc UI; không có hash/balance/block giả làm bằng chứng trong báo cáo này.

## Checklist kiểm thử thủ công

1. Step 1 hiển thị địa chỉ #0 đúng OffCKB; mở dependencies để xem dep group/members live và code hash matched. Tắt node nếu muốn kiểm tra lỗi kết nối, sau đó dùng lại dữ liệu node cũ.
2. Nhập `61`, `-1`, `1e2`, số quá 8 phần lẻ hoặc owner khác #0 qua API: phải bị chặn, không có operation mới. Nhập `100`, bấm Create đúng một lần và chờ committed. Kiểm tra output 0 capacity, lock #0, data `0x4c`, live. Phần change không phải Cell bài học.
3. Bấm Test Unauthorized. Kết quả phải có đối chứng authorized cycles, chữ ký 65 byte hợp lệ, recovered args khác owner args, actual RPC `-302`/lock error `-31`, `passed: true` và `cellStillLive: true`. Không có funding/spend operation mới và Cell vẫn được chọn. Nếu method không hỗ trợ hoặc lỗi khác, phải inconclusive; không bấm Spend cho đến khi giải quyết.
4. Bấm Spend với destination #1. Kiểm tra input là đúng Cell Step 2, output capacity là input trừ phí, destination lock đúng #1. Pending/proposed hiển thị đúng và được polling chỉ đọc.
5. Khi committed, Inspect phải có block number và tất cả check liên quan đạt. Raw original Cell có thể `unknown`, nhưng `consumedByCommittedTransaction` phải là hash spend thật. New output 0 phải live. Kiểm tra node/RPC độc lập nếu cần.
6. Bấm Refresh, chuyển tab và reload: không tự tạo/ký/gửi giao dịch. Restart riêng web server: history vẫn giữ nhờ journal. Không sửa/xóa journal đang dùng.
7. Gửi lại đúng POST/key/body: không tạo giao dịch khác. Cùng key nhưng khác capacity/receiver trả `409`. Hai request đồng thời bị mutex chặn. Mất response thì Retry same submission phục hồi cùng hash/signed bytes.
8. Thử spend Cell đã tiêu, Cell ngoài journal, outpoint index khác 0, creation pending hoặc địa chỉ mainnet: phải bị chặn. Kiểm tra lỗi Origin/Host, thiếu JSON hoặc gửi field `privateKey`/`command`: bị từ chối trước signing.
9. Kiểm tra Token/DOB đọc được dữ liệu cũ và giữ luồng hiện hữu; trong khi Lock Script pending, funding ở module khác phải bị chặn. Khi tạo funding/token/DOB khác, Cell marker bài học chưa tiêu vẫn live.

## Giới hạn thực tế và trạng thái xác minh

- Runtime Devnet/browser, contract execution và broadcast **chưa được chạy trong lượt triển khai này**. Không có transaction hash, ảnh hay số dư mới được công bố là evidence.
- Chỉ standard Secp256k1 20-byte args; chưa có custom lock, multisig, OmniLock hoặc timelock. Destination spend giới hạn standard Secp256k1 Devnet.
- `estimate_cycles` cần được node hỗ trợ. Backend không fallback sang broadcast giao dịch cố tình sai nếu RPC không hỗ trợ; bài kiểm tra dừng ở inconclusive/error.
- Cần Account #0 có đủ plain CKB funding để tạo output, change và phí. Fee rate đặt cố định cho local lab; node cấu hình mức tối thiểu cao hơn có thể từ chối pool và cần chỉnh hằng số backend.
- Marker ngăn bộ chọn funding hiện tại của ứng dụng chọn Cell này; công cụ bên ngoài có key owner vẫn có thể tiêu nó. Khi đó liveness/verification phản ánh chain, không giả định ownership từ journal.
- Chạy một backend process trên một data directory. Mutex không khóa process khác hoặc OffCKB CLI; indexer có thể trễ, input có thể bị công cụ khác tiêu sau kiểm tra. Chờ đồng bộ rồi Inspect/retry đúng request; không dựng lại âm thầm.
- Giữ cả journal và blockchain tương ứng. Mất journal không tự reconstruct được lịch sử test/operation; journal sai/genesis khác bị chặn. Đây không phải cơ chế lưu trữ evidence chống chỉnh sửa bởi người quản trị máy.
- Trạng thái pending/unknown chưa giải quyết có thể chặn funding mới. Reconciliation conflict kiểm tra lịch sử có giới hạn trang; không tìm thấy bằng chứng thì vẫn giữ unknown. Node policy rejection không thuộc script verification có thể cần kiểm tra pool/node thủ công.
- Không có bảo đảm finality/reorg dài hạn; new output có thể bị tiêu tiếp sau lúc xác minh. Check `newOutputLive` sẽ chuyển false nếu output đã tiêu; lịch sử committed vẫn đọc được.

Kiểm tra offline đã thực hiện: TypeScript `tsc --noEmit`; cú pháp `app.js`, `dob.js`, `lock-script.js`; kiểm tra HTML không trùng ID, 26 tham chiếu DOM trực tiếp của Lock Script đều tồn tại, script `defer` đúng thứ tự; unit tests với RPC fixtures, khóa chỉ dùng trong test, không truy cập key dev hoặc broadcast. Bộ `test:unit` lúc triển khai đạt **118 tests, 0 failed, 0 skipped**. Không phát sinh runtime journal của Lock Script trong lúc kiểm tra. Kết quả unit/fixture không được hiểu là runtime CKB-VM hoặc browser đã được xác minh.
