# AI Civis（工程進度與施工抽查驗系統）

本專案參考 `jsrcm` 的 `schedule` 與 `audit` 模組獨立建置，簡化權限（移除 `django-guardian` / `RcmUP` / 登入驗證）與外部儲存（S3 / Tastypie）耦合，完整保留進度管理與抽查驗核心功能，並套用現代工程 SaaS 介面風格。

## 環境需求

- **Python 3.9**（開發驗證環境為 Python 3.9.13）
- 相依套件見 `requirements.txt`（Django 4.2、Pillow、XlsxWriter、Matplotlib、python-docx、openpyxl）

## 模組架構

- `core`：工程案管理（`Project`）、系統總覽儀表板、範例資料指令 `seed_demo`
- `schedule`：完整版預定進度設定精靈
  - 三種模式：節點要徑 CPM 模式（GoJS 互動網圖）、階層式甘特圖模式（dhtmlxGantt 7.1.9 + 右鍵階層管理）、簡易區間模式（固定天數 / 按月拆段）
  - CPM 要徑計算引擎（FS/SS/FF/SF + Lag、循環依賴偵測、自動展延補滿至目標工期）
  - 權重自動配平至 100%、Chart.js S 曲線、草稿跨模式複製
  - 匯入／匯出：Excel 匯入與日報表格式匯出、甘特圖 Excel（含 CPM 圖 / ADM 圖 / S 曲線 / 逐日進度）、ADM 箭線圖 PNG、甘特圖 + S 曲線 PNG、JSON / SCPM 精靈備份檔
- `audit`：施工抽查驗與自主檢查
  - 施工抽(查)驗表 / 自主檢查表樣板編輯、複製與匯出空白 Word 表單（`.docx`）
  - 套用樣板建立抽查驗紀錄、合格／不合格／免檢判定、自動建立缺失追蹤
  - 缺失改善追蹤看板、現場／缺失／改善相片上傳、HTML5 手寫電子簽名（SignaturePad）
  - 匯出：抽查紀錄 Excel（`.xlsx`）、缺失改善追蹤表 Word（`.docx`）

## 快速啟動

```powershell
cd C:\dev\ai_civis

# 建立獨立虛擬環境（Python 3.9）並安裝套件
py -3.9 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 資料庫遷移、建立範例資料並啟動伺服器
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 8001
```

- 系統首頁：`http://127.0.0.1:8001/`
- 預定進度精靈：`http://127.0.0.1:8001/schedule/manage_schedule/`
- Django Admin：`http://127.0.0.1:8001/admin/`（預設帳號 `admin` / 密碼 `admin123`）
