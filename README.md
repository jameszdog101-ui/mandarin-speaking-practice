# 華語逐句口說練習平台 v1.1

提供教師建立作業、學生設備測試、逐句限次錄音與完成確認。正式架構使用 Cloudflare Workers、D1、R2 與 Workers Assets；原本的 Node.js 本機伺服器仍保留供離線開發參考。

## 啟動

需 Node.js 20 以上：

```bash
npm install
npm run cf:migrate:local
npm run dev
```

Wrangler 會顯示本機網址。舊版 Node 伺服器可用 `npm start` 啟動於 `http://localhost:3000`。測試：`npm test`。

## Cloudflare 資料連動

- `wrangler.jsonc` 定義 `DB`（D1）、`AUDIO`（R2）及 `ASSETS` 綁定。
- `migrations/0001_initial.sql` 建立正式資料表、限制與索引。
- `worker/index.mjs` 直接讀寫 D1，正式錄音存入非公開 R2。
- 學生作答 API 使用 session token；管理 API 與 R2 音訊讀取使用雜湊後的管理金鑰。
- 建立遠端 D1 後，需把實際 `database_id` 寫入 `wrangler.jsonc`，再執行遠端 migration。

## 已實作

- 教師設定每題 1–10 次（預設 2 次），且由後端驗證。
- 已有學生開始後禁止修改錄製上限。
- 學生必經麥克風權限、音量顯示、4 秒測錄與本機播放。
- 測試音檔只用 Blob URL 留在瀏覽器，離頁即釋放，不傳至伺服器。
- 正式錄音在完整上傳成功後才計次；錄音啟動或上傳失敗不計次。
- 每題採用後鎖定並依序前進；全部題目完成後才記錄完成時間。
- 匿名或姓名／學號模式。
- 教師檢閱畫面、受管理金鑰保護的管理 API 與已採用音檔播放。

## API 摘要

- `POST /api/assignments` 建立作業
- `PUT /api/assignments/:id` 發布後、尚無人作答時修改次數（`X-Admin-Key`）
- `GET /api/assignments/code/:code` 學生取得公開作業資訊
- `GET /api/assignments/:id/submissions` 教師檢閱提交（`X-Admin-Key`）
- `POST /api/sessions` 完成設備測試後建立作答階段
- `POST /api/sessions/:id/sentences/:sentenceId/attempts` 上傳正式音訊並計次
- `POST /api/sessions/:id/sentences/:sentenceId/accept` 採用最新一次錄音
- `POST /api/sessions/:id/complete` 完成作業

## 正式部署注意事項

- 除 `localhost` 外，瀏覽器麥克風 API 需要 HTTPS。
- MVP 使用 JSON 檔與本機音檔儲存；正式多人環境建議改用 PostgreSQL 與物件儲存，並用資料庫交易鎖定計次。
- 教師端正式上線前應加入帳號登入、授權與音檔存取權限。目前以建立作業時產生的管理金鑰保護管理 API。
- 應另外訂定正式錄音保存期限、刪除機制、同意文字與備份政策。
