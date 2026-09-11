# Quack Aloud

> status: MVP，共用畫布，可在本機或自行部署的服務使用

Quack Aloud 是帶畫布的橡皮鴨除錯法：你對一隻鴨子把想法說出來，它把你說的歸檔成卡片、主題和關係，畫在聊天欄旁邊的無邊際畫布上。開啟 **AI guidance** 它還會追問和質疑，用標示為它自己的卡片。本文件給要執行或擴充這個 app 的人看。English version: [README.md](README.md)。

coding agent 的共用規則與改檔備援見 [duck guide](docs/duck-guide.md)；三個 agent 的設定見 [Agent 設定](#agent-setup)。

## 為什麼做這個

大多數 AI 工具把思考的順序倒過來：你提問、模型作答，然後你去檢查一份不是自己做的功課。Quack Aloud 借用 Terence Tao 談數學與 AI 合作時建議的兩個習慣：[^tao] 內容留給人、只把機械的部分交出去，以及 AI 主要拿來 red-team 自己的工作。鴨子從不替你想出那個想法；它歸檔的是你的話，每張卡都能對回原句，你要求時它才反駁。最後你得到的是自己的理解，攤開來讓你看見哪裡還薄。

[^tao]: Terence Tao，[〈Mathematical methods and human thought in the age of AI〉](https://terrytao.wordpress.com/2026/03/29/mathematical-methods-and-human-thought-in-the-age-of-ai/)（2026 年 3 月 29 日）：定理的敘述由人寫或仔細審閱，證明交給工具；AI 的使用限制在 red-team 自己的工作、或自己有能力 red-team 的工作。另見他 ICM 2026 的演講 [〈Mathematics in the age of AI〉](https://mathstodon.xyz/@tao/116977934921819775)。他談的是證明；這個工具只是借用那兩個習慣。

## Demo

| 情境 | 發生什麼 |
|---|---|
| ![滿版跟鴨子說話](docs/demo-talk.gif) | **跟鴨子說話**。按「Talk to the duck」進舞台：在大鴨子下面打字（或用說的）、送出、看牠思考、回覆直接出現在牠下面；回到畫布時新卡片已經歸好。這段裡牠質疑「凶兆傳開之後兩戶人家搬走」的因果方向 |
| ![小說構思，引導開](docs/demo-novel.gif) | **構思故事**（guidance 開）。丟進三段懸疑故事的片段；鴨子把人物、事件、說法各自歸檔，自動選用 Timeline 版面，第三句從「她看過貓」跳到「所以他沒說謊」時，鴨子用一張 challenge 卡回嘴 |
| ![學新事物，引導先關後開](docs/demo-learning.gif) | **學新東西**（guidance 先關後開）。關於 TOPS 的筆記變成有中介概念的心智圖；開啟 guidance 後說「TOPS 越高一定越快」，被質疑 INT8 與 FP16 基準不同、還要看記憶體頻寬 |

## 運作方式

| 元件 | 做什麼 | Note |
|---|---|---|
| `data/projects/<pid>/` | 一個專案一個資料夾：`project.json`（名稱）加上一個 canvas 一個檔 `<cid>.json`，內含主題、卡片、關係、對話紀錄、版面 | 唯一的資料來源。所有寫入者（聊天 API、瀏覽器編輯、Claude Code、文字編輯器）都寫這些檔。舊版格式（`data/graph.json`、單檔的 `data/projects/<id>.json`）會在啟動時自動搬過來 |
| `server/` | 跑在 `API_PORT` 的 Express API | 監看 `data/projects/`，每次變動用 SSE（`/api/events`）推給瀏覽器 |
| `server/providers/` | LLM 後端 | 用 Settings 或 `PROVIDER` 切換 `claude`（Anthropic API）與 `openai`（OpenAI Responses API） |
| `src/` | Vite + React + React Flow 的 UI | 左邊聊天、右邊畫布 |
| `server/mcp.ts`、`server/mcpHttp.ts` | 鴨子的 MCP server：五個工具，走 stdio 或 HTTP 的 `/mcp` | 讓 Claude Code、Codex、Antigravity 或任何 MCP client 透過 `duck_turn` 歸檔卡片，用 agent 自己的方案、不需 API key。見下方「MCP server」 |
| `AGENTS.md`、`CLAUDE.md`、`.agents/` | coding agent 的指引 | Codex 使用 `AGENTS.md` 和 `$duck`；Claude Code 與 Antigravity 使用 `/duck`。三者都讀[共用 duck guide](docs/duck-guide.md)，優先用 MCP，必要時才用本機改檔備援 |

## 開始使用

需要 Node.js 22 以上和 npm；Docker image 已包含 Node.js 22。

1. `npm install`
2. `cp .env.example .env`
3. `npm run dev`
4. 開 http://localhost:5173，建立 Quack Aloud owner 帳號或登入；這個網站帳號和 AI 供應商帳號是分開的
5. owner 按右上角 **Settings**，選 `claude`（預設）或 `openai`，填對應的 Anthropic 或 OpenAI API key 後 Save。瀏覽器聊天按 API 帳號計費，與 Claude／ChatGPT／Codex 訂閱分開。key 存在 server 的 `data/settings.json`，只有檔案擁有者可讀，不會傳回完整金鑰。也可在 `.env` 設 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`
6. 輸入類似「首頁載入很慢，我猜是資料庫的問題」然後按 Enter。你會看到兩張黃色卡片在一個淡色主題容器裡、中間一條邊，以及一句「歸了什麼」的回覆
7. 開啟聊天欄上方的 **AI guidance**，再送一句想法。這時會多出一兩張鴨子的藍色虛線卡，回覆也變成口語的兩三句

沒有 API key 也可以試畫布：用畫布右上角的 Import 匯入 `data/sample-graph.json`，它會變成一個新專案。

## 用 Docker 執行

一個 image 同時在 8787 服務 API 和 build 好的 UI；專案資料放在 volume。

| 步驟 | 指令 | Note |
|---|---|---|
| 1 | `cp .env.example .env`，設定 `PROVIDER` 與對應的 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` | container 透過 `docker compose` 讀 `.env` |
| 2 | `docker compose up --build` | 建 image 並啟動；開 http://localhost:8787 |
| 3 | 資料就是 dev server 用的同一個 `./data/` | `projects/`、`trash/`、備份。Claude Code、Codex 與 Antigravity 路線照常可用：它們透過 MCP 或改 host 上的 `data/projects/<pid>/<cid>.json`，container 裡的 watcher 收得到（在 Mac 的 Docker Desktop 驗證過；Linux 上檔案擁有者會是 uid 1000）。要放別的路徑就掛到 `/data` |

不用 compose 的話：`docker build -t quack-aloud .`，然後 `docker run -p 8787:8787 -e ANTHROPIC_API_KEY=... -v $PWD/data:/data quack-aloud`。

不用 compose 而要改用 OpenAI，可把 Anthropic key 的參數換成 `-e PROVIDER=openai -e OPENAI_API_KEY=...`；image 裡不需要 Codex 執行檔或 Codex 登入。

Kubernetes：`deploy/k8s/quack-aloud.yaml` 是最小的 Deployment + Service + PVC。狀態是檔案，所以只能單一 replica 配 ReadWriteOnce volume（`strategy: Recreate`），API key 從 Secret 來。對外開放前一定要放在有認證的 Ingress 後面，因為每則訊息都花 API 額度。驅動即時更新的 `fs.watch` 在某些網路檔案系統上不會觸發，請用 block volume，不要用 NFS。stdio／改檔路線需要 agent 能存取本機資料；遠端 agent 可用帶認證的 HTTP MCP 連到叢集。

## 讓 coding agent 當鴨子（不用瀏覽器 API key）

Claude Code、Codex 和 Google Antigravity 都可透過 MCP 歸檔想法，使用 agent 自己的帳號與額度。瀏覽器聊天另外使用選定的 Claude 或 OpenAI API provider；選 `openai` 不會啟動 Codex，也不使用 ChatGPT 訂閱額度。三者遵循[共用整理規則與本機改檔備援](docs/duck-guide.md)。

| 設定 | Claude Code | Codex | Antigravity |
|---|---|---|---|
| 專案指引 | `CLAUDE.md` | `AGENTS.md` | `.agents/rules/quack-aloud.md` |
| 明確呼叫 | `/duck <想法>` | `$duck <想法>` | `/duck <想法>` |
| 指令／skill 檔 | `.claude/commands/duck.md` | `.agents/skills/duck/SKILL.md` | `.agents/skills/duck/SKILL.md` |
| repo 內的本機 MCP 設定 | `.mcp.json` | `.codex/config.toml` | 在 MCP 設定加入下方 entry |

### MCP server（給 agent 用，建議走這條）

app 提供五個工具：`list_projects`、`read_canvas`、`create_project`、`create_canvas`、`duck_turn`。agent 讀取 canvas 並拆解想法；`duck_turn` 套用和瀏覽器聊天相同的擺位、id 處理、階層、對話紀錄與引導過濾。server 的 instructions 包含 `server/prompt.ts` 的同一組整理規則。

| 傳輸 | 適用情境 | 生命週期與認證 |
|---|---|---|
| **本機 stdio** | agent 能存取這個 checkout 和 app 的資料目錄 | client 啟動子行程。不需網站 session、瀏覽器 API key 或 MCP token；app 可以停止 |
| **HTTP**：`/mcp` | app 在本機、Docker 或遠端（含 Kubernetes）執行 | app 在 `API_PORT`（預設 8787）提供端點，需要該安裝的 MCP bearer token；不用另開 MCP 行程 |
| **Docker stdio** | Docker 在本機執行，希望子行程在運作中的 container 內 | client 啟動 `docker compose exec -T …`，使用 container 的 `/data`；host 不需 Node，也不需 MCP token |

<a id="codex-setup"></a>
<a id="agent-setup"></a>
### Agent 設定

以下涵蓋三個 client。先依選用 agent 的一般流程安裝並完成認證；agent 登入、Quack Aloud 網站帳號，以及瀏覽器 API key 各自獨立。

#### 第一次在本機使用

1. 在 repo 根目錄執行 `npm install`，再執行 `npm run dev`。
2. 開 http://localhost:5173，建立／登入 **Quack Aloud** 網站帳號才能看畫布。透過外部 agent 提交想法時，不必設定瀏覽器 provider key。
3. 在 agent 開啟這個 checkout，依下方說明設定本機 MCP。若使用自訂資料目錄，MCP 行程的 `DATA_DIR` 必須和 app 指向相同的絕對路徑。
4. 檢查連線，再用該 client 的 duck 呼叫方式提交想法。有多個專案／canvas 時請明確指定；MCP 看不到瀏覽器的選擇，最近更新只是一個推測。

stdio 子行程由 agent 啟動，不用在另一個終端機手動執行 `npm run mcp`。app 要執行才看得到即時更新，但 app 停止時 stdio 仍可歸檔。

##### Claude Code — 本機

1. **從這個 repo 根目錄**啟動 Claude Code，讓 `.mcp.json` 正確解析 `server/mcp.ts`。它已登記 `quack-aloud`；出現提示時核准專案／server。
2. 開 `/mcp` 檢查 `quack-aloud`。若新加入的 `.claude/commands/duck.md` 尚未載入，開新對話。
3. 輸入 `/duck 首頁很慢，我懷疑是資料庫。請引導我。`

`CLAUDE.md` 提供專案指引。repo 內的 stdio 設定不需另外執行 `claude mcp add`。設定範圍與核准方式見 [Claude Code MCP 設定](https://code.claude.com/docs/en/mcp)。

##### Codex — 本機

1. 開啟並信任這個 repo。`.codex/config.toml` 透過 `npm run --silent mcp` 登記 `quack-aloud`；即使從子目錄啟動，npm 也會找到 package 根目錄。
2. 首次設定後若 server 或 skill 尚未載入，重啟 Codex。CLI 的 `/mcp` 檢查連線，`/skills` 或 `$` 選 skill。`codex mcp get quack-aloud --json` 檢查設定，不代表已成功連線。
3. 輸入 `$duck 首頁很慢，我懷疑是資料庫。請引導我。`

`AGENTS.md` 提供專案指引，`.agents/skills/duck/SKILL.md` 提供 skill。`$duck` 不是原生 `/duck` slash command。參考 [Codex MCP 設定](https://learn.chatgpt.com/docs/extend/mcp)、[專案指引](https://learn.chatgpt.com/docs/agent-configuration/agents-md)與 [skills](https://learn.chatgpt.com/docs/build-skills)。

##### Antigravity — 本機

1. 將這個 repo 開為 workspace，或從根目錄執行 `agy`。在 MCP 設定開啟自訂 server 設定。IDE 路徑為 agent 面板 **… → MCP Servers → Manage MCP Servers → View raw config**；其他介面可在 Customizations 找 MCP。
2. 在 client 開啟的設定檔，把下列 entry 合併進 `mcpServers`，並換成實際 checkout 路徑：

   ```json
   {
     "mcpServers": {
       "quack-aloud": {
         "command": "npm",
         "args": ["run", "--silent", "mcp"],
         "cwd": "/absolute/path/to/quack-aloud"
       }
     }
   }
   ```

3. 重新載入 MCP 設定，確認 server 的五個工具可用。若 workspace 規則／skill 尚未載入，開新 agent 對話，再輸入 `/duck 首頁很慢，我懷疑是資料庫。請引導我。`

repo 提供 `.agents/rules/quack-aloud.md` 和 `.agents/skills/duck/SKILL.md`，但沒有預先登記 Antigravity MCP entry。修改設定時保留其他 server。參考 [Antigravity MCP 設定](https://antigravity.google/docs/mcp/)。

也可以從 repo 根目錄用 Antigravity CLI 登記本機 stdio：

```sh
agy mcp add --env "DATA_DIR=$PWD/data" quack-aloud npx -y tsx "$PWD/server/mcp.ts"
```

若 app 使用其他 `DATA_DIR`，請改成相同路徑。指令會儲存絕對路徑，讓 server 能從其他目錄啟動。用 `agy mcp list` 檢查登記結果，並以 `/mcp` 檢查實際連線。

每個 client 都預設關閉引導；加「guide」「引導」「質疑」才開啟，瀏覽器開關不會設定外部 agent 的模式。說「new project: <name>」／「開新專案：<名稱>」或「new canvas: <name>」／「開新畫布：<名稱>」可建立項目，之後到瀏覽器選單切換。自然語言要求歸檔也可使用同一流程；解釋或修改 app 的要求則屬於開發工作。

#### HTTP、Docker 與遠端安裝

三個 agent 都適用以下步驟：

1. 啟動目標 app。Docker Compose 使用 `docker compose up` 和 http://localhost:8787；遠端／Kubernetes 需要外部可連線的 HTTPS URL。使用結尾為 `/mcp` 的 API 端點，不是 canvas URL 或 `/api`。
2. 以 **owner** 登入該安裝，開 **Settings → MCP access**，複製端點和 token。token 可讀寫所有專案；`MCP_TOKEN` 可固定它，否則 app 自動產生，owner 可輪替。
3. 依下方 client 步驟為 `quack-aloud` 選定**一種傳輸**。部署專用修改留在本機，不要 commit 真實 token。agent 在另一台機器時，把 `localhost` 換成 app 可連線的 host，並使用 HTTPS。
4. 重新連線／重啟 client，確認工具後再歸檔。HTTP 需要 app 執行，不需要在 agent 的機器安裝 Node 或此 app 的依賴。保持 repo 開啟以載入指引與 duck 指令／skill；只加入 MCP 不會把這些檔案安裝到其他 workspace。

Quack Aloud MCP 使用固定 bearer token，不走 OAuth 登入流程。網站 cookie 與 provider API key 都不能代替這個 token。輪替後需更新所有 HTTP client 並重新連線。

##### Claude Code — HTTP

從這個 repo 根目錄使用 **Settings → MCP access → Claude Code → copy the add command**，或替換以下 placeholder：

```sh
claude mcp add --scope local --transport http quack-aloud https://your-quack-host/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

local scope 會覆蓋此 checkout 的 project `.mcp.json` entry。若 local entry 已存在，更新它，不要新增重複項目。複製的指令含有 token，請保密且不要放入共用 script。重啟／重新連線後以 `/mcp` 檢查。

另一個方式是在專案 `.mcp.json` 只取代 `quack-aloud`，保留其他 server：

```json
{
  "mcpServers": {
    "quack-aloud": {
      "type": "http",
      "url": "https://your-quack-host/mcp",
      "headers": { "Authorization": "Bearer ${QUACK_ALOUD_MCP_TOKEN}" }
    }
  }
}
```

在 Claude Code 的啟動環境設定 `QUACK_ALOUD_MCP_TOKEN`。local-scope entry 優先於 project entry；若載入錯誤傳輸，以 `claude mcp get quack-aloud` 檢查。Claude 支援在這些 header 展開環境變數。[Claude MCP 參考](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json)。

##### Codex — HTTP

選 **Settings → MCP access → Codex → copy HTTP config**。在這個 repo，取代 `.codex/config.toml` 的 `[mcp_servers.quack-aloud]` table，移除 stdio 的 `command` 和 `args`：

```toml
[mcp_servers.quack-aloud]
url = "https://your-quack-host/mcp"
bearer_token_env_var = "QUACK_ALOUD_MCP_TOKEN"
```

在 Codex 啟動環境設定 `QUACK_ALOUD_MCP_TOKEN` 後重啟／重新連線。從其他地方啟動的桌面 app 不會自動取得 shell 變數。設定檔放的是變數名稱，不是 token。

在沒有此專案設定的其他 workspace，**copy the add command** 提供相當於以下指令的內容：

```sh
codex mcp add quack-aloud --url https://your-quack-host/mcp --bearer-token-env-var QUACK_ALOUD_MCP_TOKEN
```

這會新增使用者層級設定。專案設定優先，因此只執行此指令不會取代 repo 的 stdio table。它登記的是工具；除非另行安裝，`$duck` 仍限於 repo。[Codex MCP 參考](https://learn.chatgpt.com/docs/extend/mcp)。

##### Antigravity — HTTP

使用 **Settings → MCP access → Antigravity → copy the add command**，或替換下方占位文字：

```sh
agy mcp add --header "Authorization: Bearer <MCP_TOKEN>" quack-aloud https://your-quack-host/mcp
```

flag 放在 server 名稱前面；CLI 會辨識 HTTP URL。共用的個人設定檔是 `~/.gemini/config/mcp_config.json`，IDE 的 MCP 設定也能開啟它。若已登記本機 `quack-aloud`，請更新同一個 entry 為 HTTP。參考 [Antigravity MCP 設定](https://antigravity.google/docs/cli/mcp/)。

也可以手動編輯 client 開啟的 MCP 設定，以以下內容取代本機 `quack-aloud` entry。儲存 token 時使用**個人／全域設定**，並保留其他 server：

```json
{
  "mcpServers": {
    "quack-aloud": {
      "serverUrl": "https://your-quack-host/mcp",
      "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
    }
  }
}
```

將 `<MCP_TOKEN>` 換成目標安裝的 token，移除該 entry 的 stdio `command`、`args`、`cwd`，重新載入並確認工具。移除或更新有衝突的 workspace entry。Antigravity 的遠端 server 使用 `serverUrl`；此範例儲存真實 token，請將設定檔保密。[Antigravity MCP 參考](https://antigravity.google/docs/mcp/)。

##### Gemini CLI — HTTP

其他 MCP client 也能使用同一個端點。Gemini CLI 可替換占位文字後，登記到使用者設定：

```sh
gemini mcp add -s user -t http -H "Authorization: Bearer <MCP_TOKEN>" quack-aloud https://your-quack-host/mcp
```

用 `/mcp` 檢查連線，再呼叫 `list_projects` 和 `read_canvas`。歸檔想法時參考 `docs/duck-guide.md`。參考 [Gemini CLI MCP 設定](https://geminicli.com/docs/tools/mcp-server/)。

##### Docker stdio — 三個 client 共用

Docker 使用上方 HTTP 設定即可。若偏好 stdio，先啟動 `docker compose up`，再以下方內容取代現有 server entry。agent 的機器必須能使用 Docker。將 `/absolute/path/to/quack-aloud` 換成實際 Compose 專案路徑；MCP stdio 必須加 `-T`。

**Claude Code**（`.mcp.json`）或 **Antigravity**（自訂 MCP 設定）合併以下 JSON entry：

```json
{
  "mcpServers": {
    "quack-aloud": {
      "command": "docker",
      "args": ["compose", "--project-directory", "/absolute/path/to/quack-aloud", "exec", "-T", "quack-aloud", "npm", "run", "--silent", "mcp"]
    }
  }
}
```

**Codex** 取代 `.codex/config.toml` 的 table：

```toml
[mcp_servers.quack-aloud]
command = "docker"
args = ["compose", "--project-directory", "/absolute/path/to/quack-aloud", "exec", "-T", "quack-aloud", "npm", "run", "--silent", "mcp"]
```

改成 stdio 時移除 HTTP 欄位，並檢查 client 其他 scope 是否有覆蓋設定。子行程寫入執行中 container 的 `/data`。現有 `.mcp.docker.json` 是從 repo 根目錄啟動時可用的 Claude 相容替代範例；這個檔名不會自動取代 `.mcp.json` 載入，請用它的 entry 取代目前啟用的 entry。

Kubernetes 或其他遠端 host 使用 HTTP，不用本機 Docker 指令。host stdio／改檔只適用於能存取目標資料目錄的情況。自訂本機儲存位置時，在 stdio entry 的 `env`（JSON client）或 `[mcp_servers.quack-aloud.env]`（Codex）把 `DATA_DIR` 設為與 app 相同的絕對路徑。遠端端點無法連線時，不要把想法寫進另一個本機安裝。

#### 指引與帳號

| 項目 | 用途 |
|---|---|
| `CLAUDE.md`、`AGENTS.md`、`.agents/rules/` | 各 agent 的專案指引 |
| `.claude/commands/`、`.agents/skills/` | Claude 指令，以及 Codex／Antigravity 共用的 duck skill |
| `docs/duck-guide.md` | 共用整理規則與本機改檔備援 |
| `docs/development.md` | 修改 app 的共用指引 |
| `server/prompt.ts` | 傳給瀏覽器 provider、也由 MCP 提供的執行時指引 |
| Quack Aloud email／密碼 | 網站存取；所有登入者共用專案 |
| Anthropic／OpenAI API key | 對應瀏覽器 provider 的費用來源；保存在 server |
| Claude Code／Codex／Antigravity 登入 | 外部 agent 的認證，與瀏覽器設定獨立 |
| MCP bearer token | 授權 HTTP 工具讀寫該安裝的所有專案 |

兩個瀏覽器 provider 都不會自動讀取 AGENTS.md 或 CLAUDE.md。Codex 與 Antigravity 共用 `.agents/skills/duck/SKILL.md`；專案指引則分別放在 `AGENTS.md` 與 `.agents/rules/quack-aloud.md`。每個 client／目標安裝設定一次 MCP 後即可重複使用；修改設定或憑證後重新連線。登記 MCP server 和載入 duck 指令／skill 是兩個步驟。

#### 疑難排解與測試

| 問題 | 檢查方式 |
|---|---|
| Claude 找不到 `/duck` | 開啟此 repo 並開新對話，讓 `.claude/commands/duck.md` 載入 |
| Codex 找不到 skill | 使用 `$duck` 或 `/skills`，確認 `.agents/skills/duck/SKILL.md` 存在；若尚未重新發現 skill，重啟 |
| Antigravity 找不到 `/duck` | 將此 repo 開為 workspace，確認 `.agents/skills/duck/SKILL.md`；重新載入／開新對話 |
| MCP 不見或斷線 | Claude：`/mcp` 和 `claude mcp get quack-aloud`。Codex：`/mcp` 和 `codex mcp get quack-aloud --json`。Antigravity：`agy mcp list`、`/mcp` 與連線紀錄。確認信任／核准、執行檔路徑及依賴 |
| 傳輸／端點錯誤 | 檢查實際生效的 server entry 與 scope 衝突，只選定目標安裝 |
| HTTP 401 | 確認目標安裝的 token、啟動環境或 header；輪替後重新連線，不要使用網站密碼或 provider API key |
| Docker stdio 失敗 | 確認 Compose 已執行、Docker 可用、專案路徑正確，且有加 `-T` |
| canvas 錯誤或沒有即時更新 | 指定專案／canvas，對齊端點或 DATA_DIR，並在瀏覽器選同一張 canvas；執行中的 app 必須監看同一批檔案 |
| 瀏覽器顯示沒有 API key | 外部 agent 仍可歸檔；瀏覽器聊天需由 owner 選 provider 並輸入 key |

先用 `list_projects` 和 `read_canvas` 確認連線。寫入測試請用可丟棄的安裝／DATA_DIR 和測試 canvas。`npm test` 涵蓋工具邏輯、記憶體傳輸的 MCP 協定、有認證的 HTTP、Codex 使用的 stdio 指令，以及 provider／設定。手動協定檢查可用 `npx @modelcontextprotocol/inspector`，指定 HTTP 端點與 bearer header，或 stdio 指令。

所有路線都寫入同一批 canvas 檔案。避免在 agent 寫入的同一刻拖曳卡片；瀏覽器會以「canvas changed elsewhere」拒絕過期修改。回覆 `duck_turn` 傳回的已儲存 reply，不要再以改 JSON 套用同一輪。[共用 duck guide](docs/duck-guide.md) 提供本機改檔備援步驟。

## 登入

這裡登入的是 **Quack Aloud 網站帳號**，不是 Claude、OpenAI 或 Codex。app 要求 email + 密碼，因為後面的 API key 每則訊息都要付費。帳號只管門，不分資料：能登入的人共用同一批專案。

| 情況 | 行為 | Note |
|---|---|---|
| 第一次開、還沒有帳號 | 「Create the owner account」：email 加至少 8 個字元的密碼 | 以 scrypt 雜湊存在 `data/users.json`（只有擁有者可讀）。不要 commit 或分享這個檔 |
| 之後 | 用 email 和密碼「Sign in」 | session 是 HttpOnly cookie，30 天有效；錯 5 次會鎖該來源 30 秒 |
| 多人使用 | Settings › Accounts（只有 owner 看得到）：填 email 和初始密碼新增，或移除帳號 | 最後一個 owner 不能移除 |
| Container、Kubernetes | 環境變數設 `APP_EMAIL` 和 `APP_PASSWORD` | 第一次啟動時建立 owner 帳號；已有任何帳號就忽略 |
| 改自己的密碼 | Settings › Change password | 自己的其他 session 登出；不影響別人 |
| 登出 | 頂欄「你的 email · Sign out」 | |
| 不想要登入 | `AUTH_DISABLED=1` | 只適合別人碰不到的機器 |
| 放在 reverse proxy 後面 | `TRUST_PROXY=1` | 讓 cookie 在 HTTPS 下標 Secure，速率限制也才看得到真實來源 |

外部 Claude Code、Codex、Antigravity 使用另一條路線：本機 stdio／改檔不需要網站 session；HTTP MCP 需要自己的 bearer token。在瀏覽器看畫布仍要登入。只有 owner 能改共用 AI 設定、管理帳號與 MCP token。

## 設定

owner 在右上角 **Settings** 設定 provider、API key、model、effort（聊天欄的「no key」提示也能直接打開）。存在 `data/settings.json`，權限只有擁有者可讀，存了立刻生效不用重啟。沒設定的項目退回 `.env`：

| Key | Default | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Settings 沒存 key 時，`claude` provider 用這個 |
| `PROVIDER` | `claude` | **Optional**。`claude` 或 `openai`，登記在 `server/providers/index.ts` |
| `OPENAI_API_KEY` | | Settings 沒存 key 時，`openai` provider 用這個 |
| `OPENAI_MODEL` | `gpt-5.4-mini` | **Optional**。需支援 Responses 結構化輸出及選用的 effort |
| `OPENAI_EFFORT` | `medium` | **Optional**。預設模型支援 `none` / `low` / `medium` / `high` / `xhigh`；不傳 `max` 給 OpenAI |
| `CLAUDE_MODEL` | `claude-opus-5` | **Optional** |
| `CLAUDE_EFFORT` | `medium` | **Optional**。`low` / `medium` / `high` / `xhigh` / `max`。越高越慢也越貴 |
| `API_PORT` | `8787` | **Optional**。Vite dev server 會把 `/api` 代理到這個 port |
| `DATA_DIR` | `./data` | **Optional**。放 `projects/` 和 `trash/` 的資料夾。Docker image 設為 `/data` |

每個 provider 分別記住 key、model 和 effort。切換前先 Save；切換選單會載入該 provider 的已存／預設值，並清掉還沒儲存的 key。舊版設定會保留原 provider 和憑證：讀取時把舊的共用 model／effort 歸到原 provider，下次 Settings 儲存時寫入新格式。已存設定優先於 `.env`，所以只修改環境變數 `PROVIDER` 不會覆蓋已存的選擇。

OpenAI adapter 使用 Responses API、`ThinkOutputSchema` 結構化輸出，以及 `store: false`；canvas 對話保留在本機檔案。這不代表服務端完全不保留任何資料。其他 OpenAI 模型可能支援不同 effort，請查模型文件。參考：[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[預設模型](https://developers.openai.com/api/docs/models/gpt-5.4-mini)。

## 專案與 canvas

一個專案是一組 canvas：例如一本小說可以有「概念」「人物」「第一章」，每個 canvas 有自己的卡片和對話。

| 控制項 | 位置 | 做什麼 | Note |
|---|---|---|---|
| Project › Canvas 選單 | 頂欄標題旁 | 先選專案，再選它底下的 canvas | 最後開啟的 canvas 會記在瀏覽器裡。切換專案會開它最近用的 canvas |
| + New project… / + New canvas… | 各選單最後一項 | 輸入名稱、Enter | 新專案會附一個空的「Main」canvas |
| Rename… / Delete… | 各選單最後幾項 | 原地改名；Delete 會原地問一次 | 刪掉的專案和 canvas 搬到 `data/trash/`，不會真的刪除；複製回去就能還原。刪掉專案最後一個 canvas 會自動補一個空的；刪掉最後一個專案會自動建一個新專案 |

## 模式與檢視

| 控制項 | 位置 | 做什麼 | Note |
|---|---|---|---|
| AI guidance 開關 | 聊天欄上方 | 兩種模式都會整理：卡片、主題、關係、既有卡片的修訂。**關**（Default）：只做整理，回覆是一句「歸了什麼」。**開**：鴨子會再加 question / insight / to-verify / challenge 卡片，並用口語回覆，有疑慮就回嘴 | server 端強制：關閉時任何 question / insight / to-verify 卡片都會被丟掉，含問句的回覆會換成固定摘要 |
| Map / Timeline | 頂欄 | **Map**：自由畫布。**Timeline**：同一批卡片依「哪一句話產生」分組，照你說的順序排 | 兩者讀同一個專案檔；選擇會記在瀏覽器裡 |
| Layout（Map 上） | 畫布右上角 | 卡片怎麼排。**Auto**（Default）跟隨鴨子對內容的建議；或固定一種：**Themes**（一主題一欄，有容器）、**Layered**（依邊的方向由左到右分層，適合因果與依賴）、**Timeline**（有編號的時間軸穿過事件，泳道各有標籤：人與物在上、說法與信念在下、鴨子的筆記在最下；適合故事與流程）、**Mind map**（從核心概念向兩側展開的樹，適合知識；優先沿「是一種」「屬於」「part of」這類階層關係走，所以中介概念卡會變成層次） | 切換會立刻重排。「Auto」開著時（Default），鴨子或 agent 每加入一批卡片就用目前版面重排 |

## 聊天

| 功能 | Note |
|---|---|
| 訊息送出立刻顯示，標「Sending…」 | 鴨子回覆後換成存檔的那一則 |
| 鴨子思考中可以繼續打字 | Enter 或「Queue」把訊息排進佇列，一次送一則、依序處理。某一則失敗時，它和排在後面的都會退回輸入框 |
| 跟鴨子說話 | 聊天欄最下方的「Talk to the duck」打開滿版舞台：一隻大鴨子、牠最新的回覆在下面、一個大輸入框可以打字或說話。Enter 送出（舞台不關，鴨子直接在這裡回）、Shift+Enter 換行、Esc 回到畫布 |
| 語音輸入 | 舞台上的「Speak」用瀏覽器內建的語音辨識（Chrome、Edge、Safari）。鴨子會隨你的音量跳動放大，說的話即時出現在輸入框。按鈕旁可選辨識語言（Default：中文瀏覽器是「中文（台灣）」，否則跟隨瀏覽器語言），選擇會記住。不支援的瀏覽器不會顯示 |

## 使用畫布

| 動作 | 怎麼做 |
|---|---|
| 自己加卡片 | 雙擊空白處，輸入標題，Enter（Esc 取消） |
| 連接兩張卡 | 從卡片右側的圓點拖到另一張卡 |
| 改標題 | 雙擊卡片，輸入，Enter |
| 移動卡片 | 拖曳。位置會存檔 |
| 多選 | 在空白處拖出框（碰到卡片即算選中），或 Shift + 點擊。拖任一張選中的卡會一起移動 |
| 平移 / 縮放 | 滾輪或 pinch 以游標為中心縮放；按住 Space 拖曳、或中鍵 / 右鍵拖曳平移 |
| 刪除 | 選取後按 Backspace 或 Delete |
| 全部重排 | 右上角「Tidy」，用目前版面。旁邊的「Auto」（Default 開）會在鴨子或 coding agent 加入卡片時自動做這件事；你自己加的卡片和拖曳不會觸發。想保留手排的位置就關掉 |
| 存一份 | 右上角「Export」。下載目前 canvas（含對話）成 `quack-aloud-<專案>-<canvas>-<日期>.json` |
| 載入一份 | 右上角「Import」。從匯出檔在目前專案裡建立新 canvas 並切換過去，不會覆蓋任何東西。任何合法的 canvas 檔都可以，手寫的也行 |
| 重來 | 右上角「Clear」，再按「Really clear everything?」確認。清空目前 canvas 的內容但保留它 |
| 收起聊天欄 | 頂欄的「Hide chat」，或聊天欄上的 ‹。畫布佔滿寬度；選擇會記在瀏覽器裡 |

| 外觀 | 意義 |
|---|---|
| 黃色實線卡 | 你說的內容（`origin: "user"`），拆成組成部分：**膠囊**是 entity（人、物、地點），**帶方形標記的卡**是 event，**引號卡**是 claim 或信念。滑到卡片上會顯示它來自你哪一句話 |
| 藍色虛線卡 | 鴨子補的（`origin: "ai"`）：追問、洞見或待確認的事。只在 guidance 開時出現 |
| 紅色虛線卡，帶「!」 | challenge：鴨子對你說的有疑慮（和畫布矛盾、沒說出口的假設、從證據跳到結論）並說明理由。用「challenges」連到被質疑的卡。只在 guidance 開時出現 |
| 帶標題的淡色容器 | 鴨子歸出的主題。新卡片排在所屬主題底下；「Tidy layout」會排成一主題一欄 |
| 實線邊 | 你自己說出的關係 |
| 虛線邊 | 鴨子從內容推斷的關係 |

## Scripts

| 指令 | 做什麼 |
|---|---|
| `npm run dev` | API server 加 Vite，含 hot reload |
| `npm run build` | 先 typecheck，再把 UI build 到 `dist/` |
| `npm start` | 用一個 process 在 `API_PORT` 同時服務 API 和 build 好的 UI（先跑 `npm run build`） |
| `npm run docker:build` / `npm run docker:run` | 建 image / 用 compose 建並啟動 |
| `npm run mcp` | 在 stdio 上啟動 MCP server（給 MCP client 用，不是手動跑的） |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest：graph 合併、prompt、四種版面、provider、設定遷移與權限，以及 MCP HTTP／stdio。`npm run test:watch` 會在檔案變動時重跑 |

## 加另一個 LLM provider

1. 建 `server/providers/<name>.ts`，實作 `server/providers/types.ts` 的 `ThinkProvider`。`think()` 收到組好的 system prompt、最近的對話和使用者這一輪，必須回傳符合 `ThinkOutputSchema` 的物件
2. 在 `server/providers/index.ts` 的 `REGISTRY` 登記
3. 在同一個檔案的 `describeProviderError` 補上該 SDK 的錯誤對應
4. 在 `server/providerConfig.ts` 加上預設 model、effort 選項和 key 提示，並在 `server/settings.ts` 加上環境變數對應
5. 更新 `.env.example`、兩份 README 及測試。在 Settings 選擇 provider，或在尚無已存選擇時以 `.env` 的 `PROVIDER=<name>` 設定

prompt 本身在 `server/prompt.ts`，所有 provider 共用。

## Troubleshooting

| 症狀 | 原因 | 處理 |
|---|---|---|
| 聊天欄顯示「No API key for provider」 | Settings 沒存 key，`.env` 也沒有 | 打開 Settings 貼上 key，不用重啟 |
| 右上角顯示「disconnected」 | API server 沒跑，或跑在別的 port | 看終端機的 `[server]` 那幾行；對齊 `API_PORT` |
| 手改專案檔後畫布變空 | JSON 不合法，或卡片缺 `id` / `label` | server 會略過讀不了的檔、丟掉壞的項目；修好 JSON 再存一次 |
| 專案或 canvas 從選單消失 | 資料夾或檔案被刪、名稱含小寫字母數字連字號以外的字元，或專案資料夾少了 `project.json` | 用合法名稱放回 `data/projects/<pid>/` |
| Codex 找不到 duck skill | skill／設定尚未載入，或用了 `/duck` | 用 `$duck` 或 CLI／IDE 的 `/skills`；首次設定後重啟。見 [Agent 設定](#agent-setup) |
| Claude Code 說「Unknown command: /duck」 | 對話開始時 `.claude/commands/duck.md` 還不存在；指令在對話開始時讀取 | 開新對話，或不加 `/duck` 直接打想法（CLAUDE.md 已經教 Claude Code 怎麼歸檔） |
| Antigravity 的 `/duck` 沒反應 | 沒吃到 `.agents/skills/duck/SKILL.md` | 確認這個資料夾是 workspace 根目錄（`agy` 的話是你執行它的資料夾）；舊的 `.agent/` 名稱也接受。`agy -p /skills --add-dir .` 會列出它找到的 skill（不帶 `--add-dir` 時 print mode 會在掃完 workspace 前就回答） |

## License

MIT，見 [LICENSE](LICENSE)。
