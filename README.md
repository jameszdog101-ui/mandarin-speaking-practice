# 逐句口說練習平台 v1.2

提供中文與英文教師建立作業、學生設備測試、逐句限次錄音與完成確認。正式架構使用 Cloudflare Workers、D1、R2 與 Workers Assets；原本的 Node.js 本機伺服器仍保留供離線開發參考。

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

### Staging

```bash
npm run cf:migrate:staging
npm run deploy:staging
```

Staging 使用獨立的 `mandarin-speaking-practice-staging` D1 與 `mandarin-speaking-practice-audio-staging` R2 bucket，不會與 production 資料混用。

## 已實作

- 每一題可個別設定 1–10 次錄製上限（預設 2 次），且由後端逐題驗證。
- 學生必經麥克風權限、音量顯示、4 秒測錄與本機播放。
- 測試音檔只用 Blob URL 留在瀏覽器，離頁即釋放，不傳至伺服器。
- 正式錄音在完整上傳成功後才計次；錄音啟動或上傳失敗不計次。
- 每題採用後鎖定並依序前進；全部題目完成後才記錄完成時間。
- 匿名或姓名／學號模式。
- 教師檢閱畫面、受管理金鑰保護的管理 API 與已採用音檔播放。
- 教師 Email／密碼登入（PBKDF2-SHA256）與安全的 HttpOnly session cookie。
- 教師一次查看所有作業，依中文／英文課篩選，並搜尋作業名稱、說明、題目或發音提示。
- 作業建立時逐題新增或移除題目，並個別設定該題的錄製次數上限。
- 作業詳情集中顯示題目、學生提交狀態與已採用錄音。
- 作業可設定開始與結束時間；開始前與結束後由後端禁止學生建立或繼續提交錄音。
- 已發布作業固定每頁 10 筆，可依 3／7／15／30 日、中文／英文及尚未發布／進行中／已結束篩選。
- 導覽列提供由 Google Translate 驅動的站內語言切換器，預設為繁體中文。
- 教師帳號採最高管理員邀請制；未獲邀 Email 無法自行建立帳號。
- 最高管理員可設定教師啟用／停用期間，停用後保留該教師的作業與音檔。
- 一般教師只能檢視及編輯自己的作業；最高管理員可管理全部教師作業，清單顯示發布教師。
- 最高管理員可將已截止作業的完整資料或僅學生音檔移入垃圾桶、還原或立即清除。
- 垃圾桶內容保存 30 天；Cloudflare Cron 每日從 D1 與 R2 永久清除逾期內容。
- 教師可逐份作業啟用聲音去識別化；已有學生開始作答後此設定即鎖定。
- 去識別化沿用 `PROFILE_A v2.0.1` 固定設定，在學生瀏覽器內完成音高／共振峰轉換、單聲道化、頻帶限制與音量正規化；原始錄音不會上傳，R2 只保存轉換後 WAV。
- 去識別化用於降低聲音被辨識的風險，不代表或保證完全匿名；學生自行選擇處理設定所需的生理性別，系統不從錄音推測。

## API 摘要

- `POST /api/assignments` 建立作業
- `GET|POST /api/admin/teachers` 管理教師與邀請（最高管理員）
- `PATCH /api/admin/teachers/:id` 設定教師期限或停用（最高管理員）
- `GET|POST /api/admin/trash` 檢視垃圾桶或移入已截止作業／音檔（最高管理員）
- `POST /api/admin/trash/restore` 還原垃圾桶項目（最高管理員）
- `POST /api/admin/trash/purge` 永久清除指定或全部垃圾桶項目（最高管理員）
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
- 教師端使用 PBKDF2 密碼雜湊與 HttpOnly session cookie；正式上線仍應加入 Email 驗證、忘記密碼與登入速率限制。
- 應另外訂定正式錄音保存期限、刪除機制、同意文字與備份政策。
