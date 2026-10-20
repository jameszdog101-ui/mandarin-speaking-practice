# 語言口語練習平台：2026-10-20 更新

## 分支

本輪採堆疊分支：每支從前一階段的提交建立，`main` 未修改。
最末端 `codex/student-feedback-view` 包含全部變更與整合修正。

1. `codex/audio-reliability`：三分鐘限制、PCM WAV、音訊範圍讀取。
2. `codex/teacher-submissions`：整次提交垃圾桶、收合列表。
3. `codex/compact-assignment-list`：緊湊列表。
4. `codex/question-learning-tools`：題目保護、朗讀、單字查詢。
5. `codex/platform-branding`：名稱與左上角標誌。
6. `codex/student-auth`：教師管理學生帳號、初始密碼變更、停用。
7. `codex/student-submission-history`：本人歷史提交與音訊權限。
8. `codex/teacher-feedback`：單題／整份評語、五分制、草稿與發布。
9. `codex/student-feedback-view`：學生回饋、整合測試與跨階段修正。

分階段審查時，以每支的前一支作為比較基準；整體驗收請使用最末端分支。
早期分支不是可各自獨立部署的最終版本，後續修正集中在整合分支。

## 行為

- 教師輸入全站唯一的學生帳號、姓名、選填學號及初始密碼。
- 初始或重設密碼登入後，必須改密碼；重設／停用會撤銷登入。
- 所有作業均可免登入進入；姓名／學號依教師的身分設定驗證。免登入提交不歸入帳號歷史，既有紀錄不依姓名自動歸戶。
- 此規則追溯適用所有已發布的舊作業，不需重建或重新發布；原開放／截止時間仍有效。已提交內容及原身分設定不變。
- 匿名作業可免登入；即使學生已登入，匿名提交也不綁定帳號。
- 每題每次上限 180 秒；背景分頁計時若被瀏覽器延遲，輸出仍裁切至 180 秒。
- 上傳格式為 32 kHz、單聲道 PCM WAV，三分鐘約 11.52 MB。後端驗證檔案結構與實際樣本時長。
- 舊音檔保留原檔，在播放時按需於瀏覽器解析為 WAV，以修正缺失的時長／索引；不裁切歷史音檔。
- 整次提交移入垃圾桶後從教師、學生、課堂列表與所有讀取入口隱藏，保留 30 天。
- 文字、錄音、分數均選填；單題與直接總分為 1–5 整數。
- 平均僅計入已評題目，四捨五入至小數點後兩位；採用平均後更改題分，需要再次確認總分。
- 草稿與發布快照分開；修改草稿不改動學生已看到的回饋。
- 同一份提交的批改使用版本檢查，避免多個頁面互相覆蓋。
- 音訊評語限三分鐘；未被草稿或發布快照引用的音檔，一天後由排程清理。

## 外部詞義服務

英文定義使用 Free Dictionary API，故障時使用 Wiktionary 備援；浮窗顯示來源連結。
非英文解釋優先讀取對應語言 Wiktionary 的英文詞條，未收錄時以 MyMemory 翻譯英文定義。結果有快取；第三方服務有可用性與配額限制。
只傳送選取的英文單字及公開字典定義，不傳送學生資料、整份作業或錄音。
朗讀使用瀏覽器的 Speech Synthesis；可用聲音取決於裝置。

來源：
- https://dictionaryapi.dev/
- https://en.wiktionary.org/wiki/User:Amgine/Wiktionary_data_%26_API
- https://mymemory.translated.net/doc/spec.php

## 驗證

`npm test` 包含 14 項測試，其中整合測試在隔離 Miniflare D1/R2 執行：
帳號權限、初始密碼變更、跨學生拒絕、匿名不歸戶、停用撤銷、181 秒拒收、
錄音範圍讀取、草稿不外洩、發布版本、錄音評語權限、垃圾桶還原及到期清除。

瀏覽器已檢查教師展開提交、逐題給分、採用 4.50 平均、發布回饋及學生讀取。
手機 390px 畫面已檢查無水平溢出。公開單字 public 已實測英文及繁中查詢。

仍需真實裝置人工驗收：麥克風實錄 180 秒自動停止、iOS Safari／Android Chrome
錄製與拖拉、裝置發音與 Google 語言切換。自動測試不等同於真機錄音驗收。

## 部署

先對目標環境執行新增遷移 `0007`、`0008`、`0009`，再部署完整整合分支。

```sh
npm test
npm run cf:migrate:staging
npm run deploy:staging
```

staging 已部署至 https://mandarin-speaking-practice-staging.jameszdog101.workers.dev 。正式環境尚未部署。舊 Node 伺服器僅保留原有測試／參考用途；本輪新功能以
Cloudflare Worker 為準，請用 `npm run dev` 啟動，勿用 `npm start` 驗收新功能。
