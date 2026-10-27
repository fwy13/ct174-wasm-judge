# CT174 Judge — Online Judge chạy C bằng WebAssembly

**React + TypeScript + Vite + Monaco + Clang/LLD wasm**. Serverless ở đây nghĩa là toàn bộ quá trình biên dịch/chạy/chấm được thực hiện trong Web Worker trên trình duyệt. Không có backend quản lý người dùng, không gửi code lên server.

## Cài đặt

```bash
npm install
npm run dev
```
## Bài tập

- Sắp xếp các khóa — tài liệu CT174, bài thực hành 1
- ATM dùng tham ăn — bài thực hành 2
- Tam giác số bằng quy hoạch động — bài thực hành 4
- Ba lô 0/1 — bài thực hành 4
- TSP — bài thực hành 3

## Cấu trúc

- `src/problems.ts`: ngân hàng đề, input/output chuẩn hóa, test cases.
- `src/judge.ts`: quản lý worker, timeout, so sánh stdout và trả verdict.
- `public/engine/judge-worker.js`: giao tiếp với API `shared.js` của binji/wasm-clang, biên dịch C, link và chạy WASI.
- `public/engine/shared.js`: code gốc API và MemFS từ bản Repomix người dùng cung cấp.

## Các giới hạn quan trọng

1. Phần engine `binji/wasm-clang` là **alpha demoware cũ (Clang 8-era)**, không phải sandbox online judge đã được kiểm chứng. API của engine có thể cần chỉnh sửa tương thích theo bản binary upstream. Không dùng với mã không tin cậy trong môi trường có quyền cao hoặc cho kỳ thi chống gian lận.
2. Worker timeout là watchdog phía UI. Biên dịch có thời gian chờ tổng 120 giây, sau đó mỗi test tối đa 2,5 giây; timeout được thực thi bằng terminate worker. Đây không phải đo CPU time chuẩn và chưa có hạn mức memory chặt.
3. `stdout` chỉ so sánh dạng text (chuẩn hóa CRLF, bỏ khoảng trắng cuối dòng và cuối file). `stderr` và thông báo compiler có thể được ghi trong log chung tùy MemFS upstream. Không hỗ trợ interactive programs.
4. Chỉ C/WASI, không hỗ trợ Java, Python; thư viện C thường gặp phụ thuộc khả năng của sysroot upstream. Đầu vào stdin xử lý theo giao diện memfs của dự án gốc.
5. Trình biên dịch chạy trên cùng trình duyệt, nên người dùng có thể xem và sửa hidden tests hoặc kết quả chấm; mục tiêu là **luyện tập**, không phải hệ thống thi chống gian lận.

## Credit
- Tất cả file trong `public/engine/*` thuộc về  `https://github.com/binji/wasm-clang`