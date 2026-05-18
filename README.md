# Love Letter Game (TypeScript Edition)

一款基於 TypeScript 開發的精美網頁版《情書》桌遊。這是一個 1v1 的玩家對決 AI 遊戲，完整實作了原版卡牌規則、流暢的 UI 互動與具有挑戰性的 AI。

## 🌟 遊戲特色 (Features)

- **核心遊戲機制 (Game Engine)**：使用 TypeScript 強型別實作的遊戲狀態機（GameState），確保所有卡牌規則（1-8 號）完美執行。
- **規則型 AI (Smart AI)**：
  - 具備基本邏輯判斷（如：避免公主自殺、強制伯爵夫人邏輯）。
  - **排除法猜牌**：AI 會根據目前公開的棄牌堆進行分析，提高「衛兵」猜牌的準確率。
- **自定義互動系統 (Custom UI System)**：
  - 捨棄原生彈窗，實作自定義 **Modal Overlay** 用於猜牌、看牌與結果結算。
  - 具備 **CSS3 動效**，如侍女保護狀態的藍色魔法護盾特效。
- **響應式佈局 (Responsive Layout)**：使用 Flexbox 與 Grid 打造整潔的遊戲介面與日誌系統。

## 🛠️ 技術棧 (Tech Stack)

- **TypeScript**: 核心邏輯與型別定義。
- **Vite**: 輕量級開發環境與打包工具。
- **Vanilla DOM**: 不依賴任何前端框架，純原生 DOM 操作。
- **CSS3**: 實現魔法護盾、背景模糊與卡牌陰影特效。

## 🎮 遊戲規則簡介

1. 每位玩家初始持有一張牌。
2. 回合開始時抽一張牌。
3. 從兩張手牌中選擇一張打出並執行效果。
4. 最終目的是讓對手出局，或在牌組抽完時持有數字最大的卡牌。

## 🚀 如何執行 (How to Run)

### 本地開發 (Development)

1. 安裝依賴：
   ```bash
   npm install
   ```
2. 啟動開發伺服器：
   ```bash
   npm run dev
   ```
3. 在瀏覽器打開 `http://localhost:5173`。

### 專案打包 (Build)

執行以下指令進行 TypeScript 檢查與生產環境打包：
```bash
npm run build
```
打包後的檔案位於 `dist` 目錄。

---
*Love Letter Game - Developed with ❤️ using TypeScript & Vite.*
