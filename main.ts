// main.ts - Optimized by Apple Senior Engineer
import { serve } from "https://deno.land/std@0.182.0/http/server.ts";
import { format } from "https://deno.land/std@0.182.0/datetime/mod.ts";
import { setCookie, getCookies } from "https://deno.land/std@0.182.0/http/cookie.ts";

// Initialize Deno KV
const kv = await Deno.openKv();

// Get admin password from environment variable
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

console.log(`🔒 Password Protection: ${ADMIN_PASSWORD ? 'ENABLED' : 'DISABLED'}`);

// Session Management
interface Session {
  id: string;
  createdAt: number;
  expiresAt: number;
}

async function createSession(): Promise<string> {
  const sessionId = crypto.randomUUID();
  const session: Session = {
    id: sessionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
  };
  await kv.set(["sessions", sessionId], session);
  return sessionId;
}

async function validateSession(sessionId: string): Promise<boolean> {
  const result = await kv.get<Session>(["sessions", sessionId]);
  if (!result.value) return false;

  const session = result.value;
  if (Date.now() > session.expiresAt) {
    await kv.delete(["sessions", sessionId]);
    return false;
  }

  return true;
}

async function isAuthenticated(req: Request): Promise<boolean> {
  // If no password is set, allow access
  if (!ADMIN_PASSWORD) return true;

  const cookies = getCookies(req.headers);
  const sessionId = cookies.session;

  if (!sessionId) return false;

  return await validateSession(sessionId);
}

// KV Storage Interface
interface ApiKeyEntry {
  id: string;
  key: string;
  name?: string;
  createdAt: number;
}

// KV Database Functions
async function saveApiKey(id: string, key: string, name?: string): Promise<void> {
  const entry: ApiKeyEntry = {
    id,
    key,
    name: name || `Key ${id}`,
    createdAt: Date.now(),
  };
  await kv.set(["apikeys", id], entry);
}

async function getApiKey(id: string): Promise<ApiKeyEntry | null> {
  const result = await kv.get<ApiKeyEntry>(["apikeys", id]);
  return result.value;
}

async function getAllApiKeys(): Promise<ApiKeyEntry[]> {
  const entries: ApiKeyEntry[] = [];
  const iter = kv.list<ApiKeyEntry>({ prefix: ["apikeys"] });
  for await (const entry of iter) {
    entries.push(entry.value);
  }
  return entries;
}

async function deleteApiKey(id: string): Promise<void> {
  await kv.delete(["apikeys", id]);
}

async function batchImportKeys(keys: string[]): Promise<{ success: number; failed: number; duplicates: number }> {
  let success = 0;
  let failed = 0;
  let duplicates = 0;

  // 获取所有现有的API Keys
  const existingKeys = await getAllApiKeys();
  const existingKeySet = new Set(existingKeys.map(k => k.key));

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].trim();
    if (key.length > 0) {
      try {
        // 检查是否已存在
        if (existingKeySet.has(key)) {
          duplicates++;
          console.log(`Skipped duplicate key: ${key.substring(0, 10)}...`);
          continue;
        }
        
        const id = `key-${Date.now()}-${i}`;
        await saveApiKey(id, key);
        existingKeySet.add(key); // 添加到集合中防止本批次内重复
        success++;
      } catch (error) {
        failed++;
        console.error(`Failed to import key ${i}:`, error);
      }
    }
  }

  return { success, failed, duplicates };
}

async function batchDeleteKeys(ids: string[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      await deleteApiKey(id);
      success++;
    } catch (error) {
      failed++;
      console.error(`Failed to delete key ${id}:`, error);
    }
  }

  return { success, failed };
}

// Login Page HTML
const LOGIN_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录</title>
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            background: #F1F5F9;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }
        .login-card {
            background: #fff;
            border: 1px solid #E2E8F0;
            border-radius: 16px;
            padding: 44px 40px;
            max-width: 400px;
            width: 100%;
            box-shadow: 0 4px 24px rgba(15,23,42,0.06);
        }
        .login-logo {
            width: 48px; height: 48px;
            background: #EFF6FF;
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            margin: 0 auto 24px;
        }
        .login-logo svg { width: 24px; height: 24px; }
        h1 { font-size: 22px; font-weight: 600; color: #0F172A; text-align: center; margin-bottom: 6px; }
        .subtitle { font-size: 14px; color: #64748B; text-align: center; margin-bottom: 32px; }
        label { display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px; }
        .form-group { margin-bottom: 20px; }
        input[type="password"] {
            width: 100%; padding: 10px 14px;
            border: 1.5px solid #E2E8F0;
            border-radius: 10px;
            font-size: 15px; font-family: inherit; color: #0F172A;
            background: #fff; outline: none;
            transition: border-color 0.15s, box-shadow 0.15s;
        }
        input[type="password"]:focus {
            border-color: #2563EB;
            box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
        }
        .login-btn {
            width: 100%; padding: 11px;
            background: #2563EB; color: white;
            border: none; border-radius: 10px;
            font-size: 15px; font-weight: 500;
            cursor: pointer; font-family: inherit;
            transition: background 0.15s;
        }
        .login-btn:hover { background: #1D4ED8; }
        .error-msg {
            background: #FEF2F2; color: #DC2626;
            border: 1px solid #FECACA;
            padding: 10px 14px; border-radius: 8px;
            font-size: 14px; margin-bottom: 16px; display: none;
        }
        .error-msg.show { display: block; }
        @media (max-width: 480px) {
            .login-card { padding: 32px 24px; }
        }
    </style>
</head>
<body>
    <div class="login-card">
        <div class="login-logo">
            <svg fill="none" viewBox="0 0 24 24" stroke="#2563EB" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
            </svg>
        </div>
        <h1>管理员登录</h1>
        <p class="subtitle">输入密码以访问 API 监控看板</p>
        <div class="error-msg" id="errorMessage">密码错误，请重试</div>
        <form onsubmit="handleLogin(event)">
            <div class="form-group">
                <label for="password">密码</label>
                <input type="password" id="password" placeholder="输入管理员密码" autocomplete="current-password" required>
            </div>
            <button type="submit" class="login-btn">登录</button>
        </form>
    </div>
    <script>
        async function handleLogin(event) {
            event.preventDefault();
            const password = document.getElementById('password').value;
            const errorMessage = document.getElementById('errorMessage');
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                });
                if (response.ok) {
                    window.location.href = '/';
                } else {
                    errorMessage.classList.add('show');
                    document.getElementById('password').value = '';
                    document.getElementById('password').focus();
                    setTimeout(() => errorMessage.classList.remove('show'), 3000);
                }
            } catch (error) {
                alert('登录失败: ' + error.message);
            }
        }
    </script>
</body>
</html>
`;

// Main Application HTML (continued in next message due to length)
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Droid API 监控</title>
    <style>
        /* Minimal Light Design System */
        :root {
            --bg: #F8FAFC;
            --surface: #FFFFFF;
            --surface-2: #F1F5F9;
            --text-primary: #0F172A;
            --text-secondary: #64748B;
            --text-muted: #94A3B8;
            --border: #E2E8F0;
            --border-light: #F1F5F9;
            --accent: #2563EB;
            --accent-light: #EFF6FF;
            --success: #16A34A;
            --success-light: #F0FDF4;
            --warning: #D97706;
            --warning-light: #FFFBEB;
            --danger: #DC2626;
            --danger-light: #FEF2F2;
            --shadow-sm: 0 1px 3px rgba(15,23,42,0.06);
            --shadow-md: 0 4px 12px rgba(15,23,42,0.07);
            --shadow-lg: 0 10px 30px rgba(15,23,42,0.08);
            --radius-sm: 8px;
            --radius-md: 10px;
            --radius-lg: 14px;
            --radius-xl: 18px;
            --transition: 150ms ease;
        }

        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            background: var(--bg);
            min-height: 100vh;
            color: var(--text-primary);
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }

        .code-font, .key-masked, #importKeys {
            font-family: Consolas, 'SF Mono', Menlo, 'Courier New', monospace;
        }

        /* Header */
        .header {
            background: var(--surface);
            border-bottom: 1px solid var(--border);
            padding: 0 24px;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .header-inner {
            max-width: 1400px;
            margin: 0 auto;
            height: 58px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }

        .header-left {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }

        .header-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .header-meta {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 1px;
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        .header-refresh-info {
            font-size: 12px;
            color: var(--text-muted);
            white-space: nowrap;
        }

        /* Buttons */
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 13px;
            border-radius: var(--radius-md);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid transparent;
            font-family: inherit;
            white-space: nowrap;
            transition: background var(--transition), color var(--transition), border-color var(--transition);
            line-height: 1;
        }

        .btn svg { width: 15px; height: 15px; flex-shrink: 0; }

        .btn-outline {
            background: var(--surface);
            color: var(--text-secondary);
            border-color: var(--border);
        }
        .btn-outline:hover { background: var(--surface-2); color: var(--text-primary); }

        /* Main content */
        .main {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px 24px;
        }

        /* Controls bar */
        .table-controls { margin-bottom: 14px; }

        .controls-bar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            flex-wrap: wrap;
        }

        .select-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--text-secondary);
        }

        .page-size-select {
            padding: 6px 10px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--surface);
            color: var(--text-primary);
            font-size: 13px;
            cursor: pointer;
            outline: none;
            font-family: inherit;
        }
        .page-size-select:focus { border-color: var(--accent); }

        /* Batch toolbar */
        .batch-toolbar {
            background: var(--surface);
            border: 1.5px solid #BFDBFE;
            border-radius: var(--radius-lg);
            padding: 10px 14px;
            display: flex;
            align-items: center;
            gap: 10px;
            justify-content: space-between;
            margin-bottom: 14px;
            flex-wrap: wrap;
        }

        .batch-toolbar-left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 500;
            color: var(--accent);
        }

        .batch-toolbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .batch-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 6px 12px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid #BFDBFE;
            transition: background var(--transition);
            white-space: nowrap;
            font-family: inherit;
            background: var(--accent-light);
            color: var(--accent);
        }
        .batch-btn:hover { background: #DBEAFE; }

        .batch-btn.danger {
            background: var(--danger-light);
            color: var(--danger);
            border-color: #FECACA;
        }
        .batch-btn.danger:hover { background: #FEE2E2; }

        /* Cards grid */
        .cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 14px;
        }

        /* Key card */
        .key-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 18px;
            transition: box-shadow var(--transition), border-color var(--transition);
        }

        .key-card:hover {
            box-shadow: var(--shadow-md);
            border-color: #CBD5E1;
        }

        .key-card.selected {
            border-color: var(--accent);
            background: #FAFCFF;
        }

        .key-card-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
        }

        .key-card-checkbox {
            width: 15px; height: 15px;
            cursor: pointer;
            accent-color: var(--accent);
            flex-shrink: 0;
        }

        .key-card-id {
            font-size: 12px;
            color: var(--text-muted);
            font-family: Consolas, 'Courier New', monospace;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .key-card-status {
            padding: 2px 9px;
            border-radius: 100px;
            font-size: 11px;
            font-weight: 600;
            flex-shrink: 0;
        }

        .status-good { background: var(--success-light); color: var(--success); }
        .status-warning { background: var(--warning-light); color: var(--warning); }
        .status-danger { background: var(--danger-light); color: var(--danger); }

        .key-card-key {
            font-family: Consolas, 'Courier New', monospace;
            font-size: 12px;
            color: var(--text-secondary);
            background: var(--surface-2);
            padding: 7px 10px;
            border-radius: var(--radius-sm);
            margin-bottom: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .key-card-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1px;
            background: var(--border);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            overflow: hidden;
            margin-bottom: 12px;
        }

        .key-card-stat {
            background: var(--surface);
            padding: 10px 6px;
            text-align: center;
        }

        .key-card-stat-label {
            font-size: 10px;
            color: var(--text-muted);
            font-weight: 500;
            margin-bottom: 3px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .key-card-stat-value {
            font-size: 15px;
            font-weight: 600;
            color: var(--text-primary);
            font-family: Consolas, 'Courier New', monospace;
        }

        .key-card-dates {
            display: flex;
            justify-content: space-between;
            padding: 7px 10px;
            background: var(--surface-2);
            border-radius: var(--radius-sm);
            margin-bottom: 12px;
        }

        .key-card-date { display: flex; flex-direction: column; gap: 2px; }

        .key-card-date-label {
            font-size: 10px;
            color: var(--text-muted);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .key-card-date-value {
            font-family: Consolas, 'Courier New', monospace;
            font-size: 11px;
            color: var(--text-secondary);
        }

        .usage-limits-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
            margin-bottom: 8px;
        }

        .limit-group {
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 10px;
            background: var(--surface-2);
        }

        .limit-group-title {
            font-size: 11px;
            color: var(--text-muted);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-bottom: 8px;
        }

        .limit-window-row { margin-bottom: 8px; }
        .limit-window-row:last-child { margin-bottom: 0; }

        .limit-window-meta, .limit-window-footer {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--text-secondary);
            margin-bottom: 3px;
        }

        .limit-window-label { color: var(--text-primary); font-weight: 500; }

        .key-card-progress-bar {
            height: 5px;
            background: var(--border);
            border-radius: 100px;
            overflow: hidden;
        }

        .key-card-progress-bar.compact { height: 4px; margin: 3px 0; }

        .key-card-progress-fill {
            height: 100%;
            background: var(--accent);
            border-radius: 100px;
            transition: width 0.5s ease;
        }
        .key-card-progress-fill.warning { background: var(--warning); }
        .key-card-progress-fill.danger { background: var(--danger); }

        .extra-usage-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
            padding: 7px 10px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            font-size: 11px;
            color: var(--text-secondary);
            background: var(--surface-2);
        }

        .usage-badge {
            padding: 2px 7px;
            border-radius: 100px;
            font-size: 10px;
            font-weight: 600;
        }

        .key-card-actions {
            display: flex;
            gap: 7px;
            padding-top: 12px;
            border-top: 1px solid var(--border-light);
            margin-top: 12px;
        }

        .key-card-btn {
            flex: 1;
            padding: 8px 10px;
            border: none;
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            font-family: inherit;
        }

        .key-card-btn-copy { background: var(--accent-light); color: var(--accent); }
        .key-card-btn-copy:hover { background: #DBEAFE; }
        .key-card-btn-copy.copied { background: var(--success-light); color: var(--success); }

        .key-card-btn-delete { background: var(--danger-light); color: var(--danger); }
        .key-card-btn-delete:hover { background: #FEE2E2; }

        .key-card-env-group {
            padding-top: 10px;
            border-top: 1px solid var(--border-light);
            margin-top: 10px;
        }

        .key-card-env-title {
            font-size: 10px;
            color: var(--text-muted);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-bottom: 7px;
        }

        .key-card-env-buttons { display: flex; gap: 7px; }

        .key-card-btn-env {
            flex: 1;
            padding: 7px 10px;
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--text-secondary);
            border-radius: var(--radius-sm);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: inherit;
        }
        .key-card-btn-env:hover { background: var(--accent-light); color: var(--accent); border-color: #BFDBFE; }
        .key-card-btn-env.copied { background: var(--success-light); color: var(--success); border-color: #BBF7D0; }

        /* Total card */
        .total-card {
            grid-column: 1 / -1;
            background: var(--surface);
            border: 1px solid #BFDBFE;
            border-radius: var(--radius-lg);
            padding: 20px;
        }

        .total-card-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--accent);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 14px;
        }

        .total-card-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 12px;
        }

        .total-card-stat { text-align: center; }

        .total-card-stat-label {
            font-size: 11px;
            color: var(--text-muted);
            font-weight: 500;
            margin-bottom: 3px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .total-card-stat-value {
            font-size: 24px;
            font-weight: 600;
            color: var(--accent);
            font-family: Consolas, 'Courier New', monospace;
        }

        /* Toast */
        .toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #1E293B;
            color: white;
            padding: 9px 18px;
            border-radius: 100px;
            font-size: 13px;
            font-weight: 500;
            z-index: 10000;
            animation: toastIn 0.2s ease, toastOut 0.2s ease 2.8s forwards;
            white-space: nowrap;
            box-shadow: 0 8px 24px rgba(15,23,42,0.15);
        }

        .toast.error { background: var(--danger); }

        @keyframes toastIn {
            from { opacity: 0; transform: translateX(-50%) translateY(8px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        @keyframes toastOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }

        /* Floating action buttons */
        .fab-group {
            position: fixed;
            bottom: 28px;
            right: 28px;
            z-index: 100;
        }

        .fab {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 13px 22px;
            border: none;
            border-radius: 100px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
            letter-spacing: 0.01em;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .fab svg { width: 17px; height: 17px; flex-shrink: 0; transition: transform 0.4s ease; }
        .fab:hover { transform: translateY(-3px); }
        .fab:hover svg { transform: rotate(60deg); }
        .fab:active { transform: translateY(-1px); }

        .fab-refresh {
            background: linear-gradient(135deg, #1D4ED8 0%, #3B82F6 100%);
            color: white;
            box-shadow: 0 6px 20px rgba(37,99,235,0.38), 0 2px 6px rgba(37,99,235,0.2);
        }
        .fab-refresh:hover {
            box-shadow: 0 10px 28px rgba(37,99,235,0.48), 0 4px 10px rgba(37,99,235,0.25);
        }

        .spinner {
            width: 15px; height: 15px;
            border: 2px solid rgba(255,255,255,0.35);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
            display: inline-block;
            flex-shrink: 0;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .loading {
            text-align: center;
            padding: 60px 24px;
            font-size: 15px;
            color: var(--text-muted);
        }

        .error {
            text-align: center;
            padding: 60px 24px;
            font-size: 15px;
            color: var(--danger);
        }

        /* Pagination */
        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 6px;
            padding: 20px 0;
        }

        .pagination-btn {
            background: var(--surface);
            color: var(--text-primary);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 7px 14px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all var(--transition);
            font-family: inherit;
        }

        .pagination-btn:hover:not(:disabled) { background: var(--accent); color: white; border-color: var(--accent); }
        .pagination-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .pagination-btn.active { background: var(--accent); color: white; border-color: var(--accent); }

        .pagination-info {
            font-size: 13px;
            color: var(--text-secondary);
            padding: 0 6px;
        }

        /* Manage panel */
        .manage-panel {
            position: fixed;
            inset: 0;
            background: rgba(15,23,42,0.4);
            backdrop-filter: blur(4px);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .manage-content {
            background: var(--surface);
            border-radius: var(--radius-xl);
            max-width: 560px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(15,23,42,0.12);
            animation: slideUp 0.25s ease;
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .manage-header {
            padding: 18px 20px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .manage-header h2 {
            font-size: 17px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .close-btn {
            background: none;
            border: none;
            width: 30px; height: 30px;
            border-radius: var(--radius-sm);
            cursor: pointer;
            color: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all var(--transition);
        }
        .close-btn:hover { background: var(--surface-2); color: var(--text-primary); }
        .close-btn svg { width: 16px; height: 16px; }

        .manage-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }

        .manage-section { margin-bottom: 24px; }
        .manage-section:last-child { margin-bottom: 0; }

        .manage-section h3 {
            font-size: 15px;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 4px;
        }

        .manage-section-desc {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 10px;
        }

        .manage-divider {
            height: 1px;
            background: var(--border);
            margin: 0 0 24px;
        }

        #importKeys {
            width: 100%;
            padding: 9px 12px;
            border: 1.5px solid var(--border);
            border-radius: var(--radius-md);
            font-size: 13px;
            resize: vertical;
            line-height: 1.8;
            min-height: 110px;
            font-family: Consolas, 'Courier New', monospace;
            color: var(--text-primary);
            background: var(--surface);
            outline: none;
            transition: border-color var(--transition);
        }
        #importKeys:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37,99,235,0.08); }

        .import-btn {
            margin-top: 10px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            background: var(--accent);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background var(--transition);
            font-family: inherit;
        }
        .import-btn:hover { background: #1D4ED8; }

        .import-btn.success { background: #16A34A; }
        .import-btn.success:hover { background: #15803D; }

        .import-btn.secondary {
            background: var(--surface);
            color: var(--text-secondary);
            border: 1px solid var(--border);
        }
        .import-btn.secondary:hover { background: var(--surface-2); color: var(--text-primary); }

        .import-result {
            margin-top: 10px;
            padding: 9px 12px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 500;
        }
        .import-result.success { background: var(--success-light); color: var(--success); border: 1px solid #BBF7D0; }
        .import-result.error { background: var(--danger-light); color: var(--danger); border: 1px solid #FECACA; }

        .import-btn.danger-btn {
            background: var(--danger-light);
            color: var(--danger);
            border: 1px solid #FECACA;
        }
        .import-btn.danger-btn:hover { background: #FEE2E2; }
        .import-btn.danger-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .refresh-settings-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }

        #refreshInterval {
            width: 90px;
            padding: 7px 10px;
            border: 1.5px solid var(--border);
            border-radius: var(--radius-sm);
            font-size: 14px;
            font-family: Consolas, 'Courier New', monospace;
            color: var(--text-primary);
            background: var(--surface);
            outline: none;
            transition: border-color var(--transition);
        }
        #refreshInterval:focus { border-color: var(--accent); }

        .refresh-unit { font-size: 13px; color: var(--text-secondary); }

        .refresh-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }

        #refreshStatus {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 6px;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .header { padding: 0 16px; }
            .header-inner { height: auto; min-height: 56px; padding: 10px 0; flex-wrap: wrap; }
            .header-refresh-info { display: none; }
            .main { padding: 14px 16px; }
            .cards-grid { grid-template-columns: 1fr; }
            .fab-group { bottom: 20px; right: 20px; }
            .fab { padding: 12px 18px; font-size: 13px; }
        }

        @media (max-width: 480px) {
            .manage-content { max-height: 95vh; }
            .manage-body { padding: 14px; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-inner">
            <div class="header-left">
                <div class="header-title">Droid API 余额监控</div>
                <div class="header-meta" id="updateTime">加载中...</div>
            </div>
            <div class="header-right">
                <span class="header-refresh-info">
                    <span id="autoRefreshStatus">自动刷新 · <span id="headerNextRefresh">计算中...</span></span>
                </span>
                <button class="btn btn-outline" onclick="toggleManagePanel()">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    管理密钥
                </button>
            </div>
        </div>
    </div>

    <!-- Management Panel -->
    <div class="manage-panel" id="managePanel" style="display: none;">
        <div class="manage-content">
            <div class="manage-header">
                <h2>密钥管理</h2>
                <button class="close-btn" onclick="toggleManagePanel()">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="manage-body">
                <div class="manage-section">
                    <h3>批量导入 API Key</h3>
                    <p class="manage-section-desc">每行粘贴一个 API Key，支持批量导入</p>
                    <textarea id="importKeys" placeholder="每行一个 API Key&#10;fk-xxxxx&#10;fk-yyyyy" rows="8"></textarea>
                    <button class="import-btn" onclick="importKeys()">
                        <span id="importSpinner" style="display: none;" class="spinner"></span>
                        <span id="importText">导入</span>
                    </button>
                    <div id="importResult" class="import-result"></div>
                </div>

                <div class="manage-divider"></div>

                <div class="manage-section">
                    <h3>自动刷新设置</h3>
                    <p class="manage-section-desc">设置自动刷新间隔（分钟）</p>
                    <div class="refresh-settings-row">
                        <input type="number" id="refreshInterval" min="1" max="1440" value="30">
                        <span class="refresh-unit">分钟</span>
                    </div>
                    <div class="refresh-btns">
                        <button class="import-btn success" onclick="saveRefreshSettings()">保存</button>
                        <button class="import-btn secondary" onclick="toggleAutoRefresh()" id="toggleRefreshBtn">暂停刷新</button>
                    </div>
                    <div id="refreshStatus">下次刷新: <span id="nextRefreshDisplay">计算中...</span></div>
                </div>

                <div class="manage-divider"></div>

                <div class="manage-section">
                    <h3>批量删除</h3>
                    <p class="manage-section-desc">删除已用尽（月额度 100%）的密钥，或批量删除选中的密钥</p>
                    <div class="refresh-btns">
                        <button class="import-btn danger-btn" id="clearZeroBtn" onclick="clearZeroBalanceKeys(this)">
                            清除已用尽密钥
                        </button>
                    </div>
                    <div id="clearZeroResult" class="import-result" style="display:none;"></div>
                    <p class="manage-section-desc" style="margin-top:10px;">选中卡片上的复选框后，可通过顶部工具栏进行批量删除。</p>
                </div>
            </div>
        </div>
    </div>

    <div class="main">
        <div class="table-controls">
            <div class="controls-bar">
                <div class="select-wrap">
                    <span>每页</span>
                    <select id="pageSizeSelect" class="page-size-select" onchange="changePageSize(this.value)">
                        <option value="10">10</option>
                        <option value="30">30</option>
                        <option value="100">100</option>
                        <option value="all">全部</option>
                    </select>
                </div>
            </div>
        </div>
        <div id="tableContent">
            <div class="loading">加载中...</div>
        </div>
    </div>

    <div class="fab-group">
        <button class="fab fab-refresh" onclick="loadData()">
            <span class="spinner" style="display: none;" id="spinner"></span>
            <svg id="refreshIcon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
            <span id="btnText">刷新数据</span>
        </button>
    </div>

    <script>
        // 分页变量
        const PAGE_SIZE_STORAGE_KEY = 'tablePageSize';

        let currentPage = 1;
        let itemsPerPage = getStoredPageSize() || 10; // 默认 10 条 / 页
        let allData = null;


        // 自动刷新变量
        let autoRefreshInterval = null;
        let autoRefreshMinutes = 30; // 默认30分钟
        let nextRefreshTime = null;
        let countdownInterval = null;

        // 批量选择变量
        let selectedKeys = new Set();

        function getStoredPageSize() {
            try {
                const stored = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
                if (stored === 'all') {
                    return Infinity;
                }

                const parsed = parseInt(stored);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    return parsed;
                }
            } catch (error) {
                console.error('读取分页设置失败:', error);
            }
        }

        // 本地缓存机制 - 使用localStorage持久化缓存
        class KeyCache {
            constructor(maxAge = 24 * 60 * 60 * 1000) { // 默认缓存24小时
                this.cache = new Map();
                this.maxAge = maxAge;
                this.storageKey = 'apikey_cache';
                this.loadFromStorage();
            }

            // 从localStorage加载缓存
            loadFromStorage() {
                try {
                    const stored = localStorage.getItem(this.storageKey);
                    if (stored) {
                        const data = JSON.parse(stored);
                        const now = Date.now();
                        
                        // 只加载未过期的数据
                        for (const [id, item] of Object.entries(data)) {
                            if (now - item.timestamp < this.maxAge) {
                                this.cache.set(id, item);
                            }
                        }
                        console.log(\`✅ 从本地缓存加载了 \${this.cache.size} 个 API Key\`);
                    }
                } catch (error) {
                    console.error('加载缓存失败:', error);
                }
            }

            // 保存到localStorage
            saveToStorage() {
                try {
                    const data = {};
                    for (const [id, item] of this.cache.entries()) {
                        data[id] = item;
                    }
                    localStorage.setItem(this.storageKey, JSON.stringify(data));
                } catch (error) {
                    console.error('保存缓存失败:', error);
                }
            }

            set(id, key) {
                this.cache.set(id, {
                    key: key,
                    timestamp: Date.now()
                });
                this.saveToStorage();
            }

            get(id) {
                const item = this.cache.get(id);
                if (!item) return null;

                // 检查是否过期
                if (Date.now() - item.timestamp > this.maxAge) {
                    this.cache.delete(id);
                    this.saveToStorage();
                    return null;
                }

                return item.key;
            }

            has(id) {
                return this.get(id) !== null;
            }

            clear() {
                this.cache.clear();
                localStorage.removeItem(this.storageKey);
            }

            size() {
                return this.cache.size;
            }

            // 批量添加
            batchSet(entries) {
                for (const [id, key] of entries) {
                    this.cache.set(id, {
                        key: key,
                        timestamp: Date.now()
                    });
                }
                this.saveToStorage();
            }
        }

        const keyCache = new KeyCache();

        // 并发控制类
        class ConcurrentTaskRunner {
            constructor(concurrency = 5) {
                this.concurrency = concurrency;
                this.running = 0;
                this.queue = [];
            }

            async run(tasks) {
                const results = [];
                let index = 0;

                const executeNext = async () => {
                    if (index >= tasks.length) return;
                    
                    const currentIndex = index++;
                    const task = tasks[currentIndex];
                    
                    this.running++;
                    try {
                        results[currentIndex] = await task();
                    } catch (error) {
                        results[currentIndex] = { error: error.message };
                    } finally {
                        this.running--;
                        await executeNext();
                    }
                };

                const workers = Array(Math.min(this.concurrency, tasks.length))
                    .fill(null)
                    .map(() => executeNext());

                await Promise.all(workers);
                return results;
            }
        }

        const taskRunner = new ConcurrentTaskRunner(8); // 8个并发请求

        // Toast 提示函数
        function showToast(message, isError = false) {
            const existingToast = document.querySelector('.toast');
            if (existingToast) {
                existingToast.remove();
            }

            const toast = document.createElement('div');
            toast.className = 'toast' + (isError ? ' error' : '');
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.remove();
            }, 3000);
        }

        // 复制到剪贴板函数
        async function copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (err) {
                console.error('复制失败:', err);
                return false;
            }
        }


        // 批量复制选中的 Keys - 优化版本(并发控制+缓存)
        async function batchCopyKeys() {
            if (selectedKeys.size === 0) {
                showToast('请先选择要复制的 Key', true);
                return;
            }

            try {
                showToast(\`正在复制 \${selectedKeys.size} 个 Key...\`);
                
                const ids = Array.from(selectedKeys);
                
                // 创建任务数组
                const tasks = ids.map(id => async () => {
                    // 先检查缓存
                    const cachedKey = keyCache.get(id);
                    if (cachedKey) {
                        return cachedKey;
                    }

                    // 缓存未命中，发起网络请求
                    const response = await fetch(\`/api/keys/\${id}/full\`);
                    if (response.ok) {
                        const data = await response.json();
                        // 存入缓存
                        keyCache.set(id, data.key);
                        return data.key;
                    }
                    return null;
                });

                // 使用并发控制执行任务
                const results = await taskRunner.run(tasks);
                const keys = results.filter(k => k !== null);

                if (keys.length > 0) {
                    const success = await copyToClipboard(keys.join('\\n'));
                    if (success) {
                        showToast(\`已复制 \${keys.length} 个 API Key\`);
                    } else {
                        showToast('复制失败，请重试', true);
                    }
                } else {
                    showToast('没有可复制的 Key', true);
                }
            } catch (error) {
                showToast('批量复制失败: ' + error.message, true);
            }
        }

        // 批量删除选中的 Keys - 优化版本(缓存清理)
        async function batchDeleteKeys() {
            if (selectedKeys.size === 0) {
                showToast('请先选择要删除的 Key', true);
                return;
            }

            if (!confirm(\`确定要删除 \${selectedKeys.size} 个 API Key 吗？此操作不可恢复！\`)) {
                return;
            }

            try {
                showToast(\`正在删除 \${selectedKeys.size} 个 Key...\`);
                
                const response = await fetch('/api/keys/batch-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: Array.from(selectedKeys) })
                });

                if (response.ok) {
                    const result = await response.json();
                    
                    // 从缓存中删除这些keys
                    selectedKeys.forEach(id => {
                        if (keyCache.cache.has(id)) {
                            keyCache.cache.delete(id);
                        }
                    });
                    
                    showToast(\`成功删除 \${result.success} 个 Key\${result.failed > 0 ? \`，\${result.failed} 个失败\` : ''}\`);
                    selectedKeys.clear();
                    loadData();
                } else {
                    const data = await response.json();
                    showToast('批量删除失败: ' + data.error, true);
                }
            } catch (error) {
                showToast('批量删除失败: ' + error.message, true);
            }
        }

        // 切换选中状态
        function toggleSelection(id) {
            if (selectedKeys.has(id)) {
                selectedKeys.delete(id);
            } else {
                selectedKeys.add(id);
            }
            updateBatchToolbar();
        }

        // 全选/取消全选
        function toggleSelectAll() {
            if (!allData) return;

            const allIds = allData.data.map(item => item.id);
            
            if (selectedKeys.size === allIds.length) {
                selectedKeys.clear();
            } else {
                allIds.forEach(id => selectedKeys.add(id));
            }
            
            renderCards();
        }

        // 取消所有选择
        function clearSelection() {
            selectedKeys.clear();
            renderCards();
        }

        // 更新批量操作工具栏
        function updateBatchToolbar() {
            const existingToolbar = document.querySelector('.batch-toolbar');
            
            if (selectedKeys.size > 0) {
                if (!existingToolbar) {
                    const toolbar = document.createElement('div');
                    toolbar.className = 'batch-toolbar';
                    toolbar.innerHTML = \`
                        <div class="batch-toolbar-left">
                            <span class="batch-count">已选中 <strong>\${selectedKeys.size}</strong> 个 Key</span>
                        </div>
                        <div class="batch-toolbar-right">
                            <button class="batch-btn" onclick="batchCopyKeys()">批量复制</button>
                            <button class="batch-btn danger" onclick="batchDeleteKeys()">批量删除</button>
                            <button class="batch-btn" onclick="clearSelection()">取消选择</button>
                        </div>
                    \`;
                    
                    const tableContainer = document.querySelector('.table-container');
                    const controls = tableContainer.querySelector('.table-controls');
                    if (controls) {
                        tableContainer.insertBefore(toolbar, controls.nextSibling);
                    } else {
                        tableContainer.insertBefore(toolbar, tableContainer.firstChild);
                    }
                } else {
                    existingToolbar.querySelector('.batch-count').innerHTML = \`已选中 <strong>\${selectedKeys.size}</strong> 个 Key\`;
                }
            } else {
                if (existingToolbar) {
                    existingToolbar.remove();
                }
            }
        }

        function formatNumber(num) {
            if (num === undefined || num === null) {
                return '0';
            }
            return new Intl.NumberFormat('en-US').format(num);
        }

        function formatPercentage(ratio) {
            if (ratio === undefined || ratio === null) {
                return '0.00%';
            }
            return (ratio * 100).toFixed(2) + '%';
        }

        function formatUsedPercent(percent) {
            if (percent === undefined || percent === null || Number.isNaN(Number(percent))) {
                return '0%';
            }
            return Number(percent).toFixed(0) + '%';
        }

        function formatRemainingTime(seconds) {
            if (seconds === undefined || seconds === null) {
                return 'N/A';
            }
            const value = Math.max(0, Number(seconds));
            const days = Math.floor(value / 86400);
            const hours = Math.floor((value % 86400) / 3600);
            const minutes = Math.floor((value % 3600) / 60);

            if (days > 0) {
                return hours > 0 ? days + 'd ' + hours + 'h' : days + 'd';
            }
            if (hours > 0) {
                return minutes > 0 ? hours + 'h ' + minutes + 'm' : hours + 'h';
            }
            return minutes + 'm';
        }

        function formatWindowEnd(value) {
            if (!value) {
                return 'N/A';
            }
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return 'N/A';
            }
            return date.toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });
        }

        function getLimitStatus(percent) {
            const value = Number(percent) || 0;
            if (value >= 100) {
                return { class: 'status-danger', progressClass: 'danger', text: '已用尽' };
            }
            if (value >= 80) {
                return { class: 'status-warning', progressClass: 'warning', text: '即将用尽' };
            }
            return { class: 'status-good', progressClass: '', text: '正常' };
        }

        function renderLimitWindow(label, windowData) {
            const percent = windowData?.usedPercent ?? 0;
            const status = getLimitStatus(percent);
            const width = Math.min(Math.max(percent, 0), 100);

            return '<div class="limit-window-row">' +
                '<div class="limit-window-meta">' +
                    '<span class="limit-window-label">' + label + '</span>' +
                    '<span class="limit-window-time">↻ ' + formatRemainingTime(windowData?.secondsRemaining) + '</span>' +
                '</div>' +
                '<div class="key-card-progress-bar compact">' +
                    '<div class="key-card-progress-fill ' + status.progressClass + '" style="width: ' + width.toFixed(0) + '%"></div>' +
                '</div>' +
                '<div class="limit-window-footer">' +
                    '<span>' + formatUsedPercent(percent) + '</span>' +
                    '<span title="' + (windowData?.windowEnd || '') + '">' + formatWindowEnd(windowData?.windowEnd) + '</span>' +
                '</div>' +
            '</div>';
        }

        function renderLimitGroup(title, groupData) {
            return '<div class="limit-group">' +
                '<div class="limit-group-title">' + title + '</div>' +
                renderLimitWindow('5 小时', groupData?.fiveHour) +
                renderLimitWindow('本周', groupData?.weekly) +
                renderLimitWindow('本月', groupData?.monthly) +
            '</div>';
        }

        function renderExtraUsage(extra) {
            const balance = ((extra?.extraUsageBalanceCents || 0) / 100).toFixed(2);
            const allowedClass = extra?.extraUsageAllowed ? 'status-good' : 'status-warning';
            const allowedText = extra?.extraUsageAllowed ? '超额已开启' : '超额已关闭';
            return '<div class="extra-usage-row">' +
                '<span class="usage-badge ' + allowedClass + '">' + allowedText + '</span>' +
                '<span>余额 $' + balance + '</span>' +
                '<span>超额模式: ' + (extra?.overagePreference || '未开启') + '</span>' +
            '</div>';
        }





        function renderExtraUsageCell(extra) {
            const balance = ((extra?.extraUsageBalanceCents || 0) / 100).toFixed(2);
            return '<div class="usage-cell extra">' +
                '<span>' + (extra?.extraUsageAllowed ? '超额已开启' : '超额已关闭') + '</span>' +
                '<span>$' + balance + '</span>' +
                '<span>' + (extra?.overagePreference || '未开启') + '</span>' +
            '</div>';
        }

        function loadData() {
            const spinner = document.getElementById('spinner');
            const btnText = document.getElementById('btnText');
            const refreshIcon = document.getElementById('refreshIcon');

            spinner.style.display = 'inline-block';
            if (refreshIcon) refreshIcon.style.display = 'none';
            btnText.textContent = '加载中...';

            fetch('/api/data?t=' + new Date().getTime())
                .then(response => {
                    if (!response.ok) {
                        throw new Error('无法加载数据: ' + response.statusText);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.error) {
                        throw new Error(data.error);
                    }
                    displayData(data);
                    // 预加载所有keys到缓存
                    preloadKeysToCache(data.data);
                    // 重置自动刷新计时器
                    resetAutoRefresh();
                })
                .catch(error => {
                    document.getElementById('tableContent').innerHTML = \`<div class="error">加载失败: \${error.message}</div>\`;
                    document.getElementById('updateTime').textContent = "加载失败";
                })
                .finally(() => {
                    spinner.style.display = 'none';
                    const refreshIcon = document.getElementById('refreshIcon');
                    if (refreshIcon) refreshIcon.style.display = '';
                    btnText.textContent = '刷新数据';
                });
        }

        // 预加载所有keys到缓存
        async function preloadKeysToCache(dataItems) {
            const uncachedIds = dataItems
                .filter(item => !item.error && !keyCache.has(item.id))
                .map(item => item.id);

            if (uncachedIds.length === 0) {
                console.log('✅ 所有 Key 已在缓存中');
                return;
            }

            console.log(\`🔄 预加载 \${uncachedIds.length} 个新 Key 到缓存...\`);

            // 创建任务数组
            const tasks = uncachedIds.map(id => async () => {
                try {
                    const response = await fetch(\`/api/keys/\${id}/full\`);
                    if (response.ok) {
                        const data = await response.json();
                        return [id, data.key];
                    }
                } catch (error) {
                    console.error(\`预加载 key \${id} 失败:\`, error);
                }
                return null;
            });

            // 使用并发控制执行
            const results = await taskRunner.run(tasks);
            const validEntries = results.filter(r => r !== null);

            // 批量写入缓存
            if (validEntries.length > 0) {
                keyCache.batchSet(validEntries);
                console.log(\`✅ 成功预加载 \${validEntries.length} 个 Key 到本地缓存\`);
            }
        }

        function displayData(data) {
            allData = data;
            document.getElementById('updateTime').textContent = \`最后更新: \${data.update_time} | 共 \${data.total_count} 个API Key\`;
            renderCards();
        }

        // 获取状态类名和文本
        function getStatusInfo(usedRatio, remaining) {
            if (remaining <= 0) {
                return { class: 'status-danger', text: '已用尽' };
            } else if (usedRatio >= 0.8) {
                return { class: 'status-warning', text: '即将用尽' };
            } else {
                return { class: 'status-good', text: '正常' };
            }
        }

        // 渲染卡片视图
        function renderCards() {
            if (!allData) return;

            const data = allData;
            const totalItems = data.data.length;
            const isUnlimited = itemsPerPage === Infinity;
            const totalPages = isUnlimited ? 1 : Math.max(1, Math.ceil(totalItems / itemsPerPage));

            if (currentPage > totalPages) {
                currentPage = totalPages;
            }

            const startIndex = isUnlimited ? 0 : (currentPage - 1) * itemsPerPage;
            const endIndex = isUnlimited ? totalItems : startIndex + itemsPerPage;
            const pageData = data.data.slice(startIndex, endIndex);

            let cardsHTML = '<div class="cards-grid">';

            if (!data.billingTotals) {
                const totalAllowance = data.totals.total_totalAllowance;
                const totalUsed = data.totals.total_orgTotalTokensUsed;
                const totalRemaining = data.totals.total_tokensRemaining;
                const overallRatio = totalAllowance > 0 ? (totalAllowance - totalRemaining) / totalAllowance : 0;
                cardsHTML += '<div class="key-card total-card">' +
                    '<div class="total-card-title">汇总统计</div>' +
                    '<div class="total-card-stats">' +
                        '<div class="total-card-stat"><div class="total-card-stat-label">总计额度</div><div class="total-card-stat-value">' + formatNumber(totalAllowance) + '</div></div>' +
                        '<div class="total-card-stat"><div class="total-card-stat-label">已使用</div><div class="total-card-stat-value">' + formatNumber(totalUsed) + '</div></div>' +
                        '<div class="total-card-stat"><div class="total-card-stat-label">剩余额度</div><div class="total-card-stat-value">' + formatNumber(totalRemaining) + '</div></div>' +
                        '<div class="total-card-stat"><div class="total-card-stat-label">使用百分比</div><div class="total-card-stat-value">' + formatPercentage(overallRatio) + '</div></div>' +
                    '</div>' +
                '</div>';
            }

            // 数据卡片
            pageData.forEach(item => {
                const isChecked = selectedKeys.has(item.id);
                
                if (item.error) {
                    cardsHTML += \`
                        <div class="key-card \${isChecked ? 'selected' : ''}">
                            <div class="key-card-header">
                                <input type="checkbox" class="key-card-checkbox" \${isChecked ? 'checked' : ''} 
                                       onchange="toggleSelection('\${item.id}'); renderCards();">
                                <div class="key-card-id">\${item.id}</div>
                                <span class="key-card-status status-danger">错误</span>
                            </div>
                            <div class="key-card-key">\${item.key}</div>
                            <div style="color: var(--danger); padding: 12px; text-align: center; font-size: 13px;">
                                加载失败: \${item.error}
                            </div>
                        </div>
                    \`;
                } else {
                    const billing = item.billing || {};
                    const standardMonthlyPercent = billing.standard?.monthly?.usedPercent ?? (item.usedRatio * 100);
                    const status = getLimitStatus(standardMonthlyPercent);

                    cardsHTML += \`
                        <div class="key-card \${isChecked ? 'selected' : ''}">
                            <div class="key-card-header">
                                <input type="checkbox" class="key-card-checkbox" \${isChecked ? 'checked' : ''}
                                       onchange="toggleSelection('\${item.id}'); renderCards();">
                                <div class="key-card-id">\${item.id}</div>
                                <span class="key-card-status \${status.class}">\${status.text}</span>
                            </div>

                            <div class="key-card-key" title="\${item.key}">\${item.key}</div>

                            <div class="key-card-stats">
                                <div class="key-card-stat">
                                    <div class="key-card-stat-label">总额度</div>
                                    <div class="key-card-stat-value">\${formatNumber(item.totalAllowance)}</div>
                                </div>
                                <div class="key-card-stat">
                                    <div class="key-card-stat-label">已使用</div>
                                    <div class="key-card-stat-value">\${formatNumber(item.orgTotalTokensUsed)}</div>
                                </div>
                                <div class="key-card-stat">
                                    <div class="key-card-stat-label">剩余</div>
                                    <div class="key-card-stat-value">\${formatNumber(Math.max(item.totalAllowance - item.orgTotalTokensUsed, 0))}</div>
                                </div>
                            </div>

                            <div class="key-card-dates">
                                <div class="key-card-date">
                                    <div class="key-card-date-label">开始时间</div>
                                    <div class="key-card-date-value">\${item.startDate || 'N/A'}</div>
                                </div>
                                <div class="key-card-date">
                                    <div class="key-card-date-label">到期时间</div>
                                    <div class="key-card-date-value">\${item.endDate || 'N/A'}</div>
                                </div>
                            </div>

                            <div class="usage-limits-grid">
                                \${renderLimitGroup('用量限制', billing.standard)}
                            </div>

                            \${renderExtraUsage(billing)}

                            <div class="key-card-actions">
                                <button class="key-card-btn key-card-btn-copy" 
                                        onclick="copyKeyFromCard('\${item.id}', this)">
                                    复制 Key
                                </button>
                            </div>

                            <div class="key-card-env-group">
                                <div class="key-card-env-title">复制环境变量</div>
                                <div class="key-card-env-buttons">
                                    <button class="key-card-btn-env" 
                                            onclick="copyEnvVar('\${item.id}', 'windows', this)">
                                        Windows
                                    </button>
                                    <button class="key-card-btn-env" 
                                            onclick="copyEnvVar('\${item.id}', 'unix', this)">
                                        Linux / Mac
                                    </button>
                                </div>
                            </div>
                        </div>
                    \`;
                }
            });

            cardsHTML += '</div>';

            // 添加分页控件
            if (totalPages > 1 && !isUnlimited) {
                cardsHTML += \`<div class="pagination">\`;
                cardsHTML += \`<button class="pagination-btn" onclick="changePage(\${currentPage - 1})" \${currentPage === 1 ? 'disabled' : ''}>上一页</button>\`;
                cardsHTML += \`<span class="pagination-info">\${currentPage} / \${totalPages} 页（共 \${data.data.length} 条）</span>\`;
                cardsHTML += \`<button class="pagination-btn" onclick="changePage(\${currentPage + 1})" \${currentPage === totalPages ? 'disabled' : ''}>下一页</button>\`;
                cardsHTML += \`</div>\`;
            }

            document.getElementById('tableContent').innerHTML = cardsHTML;
            updatePageSizeSelect();
            updateBatchToolbar();
        }

        // 复制环境变量函数
        async function copyEnvVar(id, platform, button) {
            try {
                let key = keyCache.get(id);
                
                if (!key) {
                    const response = await fetch(\`/api/keys/\${id}/full\`);
                    if (!response.ok) {
                        throw new Error('获取完整 Key 失败');
                    }
                    const data = await response.json();
                    key = data.key;
                    keyCache.set(id, key);
                }
                
                let envCommand;
                if (platform === 'windows') {
                    envCommand = \`\$env:FACTORY_API_KEY = "\${key}"\`;
                } else {
                    envCommand = \`export FACTORY_API_KEY=\${key}\`;
                }
                
                const success = await copyToClipboard(envCommand);
                
                if (success) {
                    button.classList.add('copied');
                    const originalText = button.innerHTML;
                    button.innerHTML = '已复制';
                    showToast(\`环境变量命令已复制 (\${platform === 'windows' ? 'Windows' : 'Linux/Mac'})\`);
                    
                    setTimeout(() => {
                        button.classList.remove('copied');
                        button.innerHTML = originalText;
                    }, 2000);
                } else {
                    showToast('复制失败，请重试', true);
                }
            } catch (error) {
                showToast('复制失败: ' + error.message, true);
            }
        }

        // 卡片视图的复制函数
        async function copyKeyFromCard(id, button) {
            try {
                let key = keyCache.get(id);
                
                if (!key) {
                    const response = await fetch(\`/api/keys/\${id}/full\`);
                    if (!response.ok) {
                        throw new Error('获取完整 Key 失败');
                    }
                    const data = await response.json();
                    key = data.key;
                    keyCache.set(id, key);
                }
                
                const success = await copyToClipboard(key);
                
                if (success) {
                    button.classList.add('copied');
                    const originalText = button.innerHTML;
                    button.innerHTML = '已复制';
                    showToast('API Key 已复制');
                    
                    setTimeout(() => {
                        button.classList.remove('copied');
                        button.innerHTML = originalText;
                    }, 2000);
                } else {
                    showToast('复制失败，请重试', true);
                }
            } catch (error) {
                showToast('复制失败: ' + error.message, true);
            }
        }

        // 卡片视图的删除函数
        async function deleteKeyFromCard(id) {
            if (!confirm('确定要删除这个 API Key 吗？')) {
                return;
            }

            try {
                const response = await fetch(\`/api/keys/\${id}\`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    showToast('删除成功');
                    keyCache.cache.delete(id);
                    selectedKeys.delete(id);
                    loadData();
                } else {
                    const data = await response.json();
                    showToast('删除失败: ' + data.error, true);
                }
            } catch (error) {
                showToast('删除失败: ' + error.message, true);
            }
        }

        // 更新分页选择器
        function updatePageSizeSelect() {
            const pageSizeSelect = document.getElementById('pageSizeSelect');
            if (pageSizeSelect) {
                const isUnlimited = itemsPerPage === Infinity;
                const selectValue = isUnlimited ? 'all' : String(itemsPerPage);
                if (pageSizeSelect.value !== selectValue) {
                    pageSizeSelect.value = selectValue;
                }
            }
        }

        function changePage(page) {
            if (!allData) return;

            if (itemsPerPage === Infinity) {
                currentPage = 1;
                renderCards();
                return;
            }

            const totalPages = Math.max(1, Math.ceil(allData.data.length / itemsPerPage));
            if (page < 1 || page > totalPages) return;

            currentPage = page;
            renderCards();
            document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function changePageSize(value) {
            const newSize = value === 'all' ? Infinity : parseInt(value, 10);

            if (Number.isNaN(newSize)) {
                return;
            }

            itemsPerPage = newSize;
            try {
                localStorage.setItem(PAGE_SIZE_STORAGE_KEY, value === 'all' ? 'all' : String(newSize));
            } catch (error) {
                console.error('保存分页设置失败:', error);
            }
            currentPage = 1;
            renderCards();
            document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // Toggle manage panel
        function toggleManagePanel() {
            const panel = document.getElementById('managePanel');
            if (panel.style.display === 'none') {
                panel.style.display = 'flex';
            } else {
                panel.style.display = 'none';
            }
        }

        // Import keys
        async function importKeys() {
            const textarea = document.getElementById('importKeys');
            const spinner = document.getElementById('importSpinner');
            const text = document.getElementById('importText');
            const result = document.getElementById('importResult');

            const keysText = textarea.value.trim();
            if (!keysText) {
                result.className = 'import-result error';
                result.textContent = '请输入至少一个 API Key';
                return;
            }

            const keys = keysText.split('\\n').map(k => k.trim()).filter(k => k.length > 0);

            spinner.style.display = 'inline-block';
            text.textContent = '导入中...';
            result.textContent = '';
            result.className = 'import-result';

            try {
                const response = await fetch('/api/keys/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keys })
                });

                const data = await response.json();

                if (response.ok) {
                    result.className = 'import-result success';
                    let message = \`成功导入 \${data.success} 个\`;
                    if (data.duplicates > 0) {
                        message += \`, 忽略 \${data.duplicates} 个重复\`;
                    }
                    if (data.failed > 0) {
                        message += \`, \${data.failed} 个失败\`;
                    }
                    result.textContent = message;
                    showToast(message);
                    textarea.value = '';
                    // 关闭弹窗并刷新主页面数据
                    setTimeout(() => {
                        toggleManagePanel();
                        loadData();
                    }, 1500);
                } else {
                    result.className = 'import-result error';
                    result.textContent = '导入失败: ' + data.error;
                }
            } catch (error) {
                result.className = 'import-result error';
                result.textContent = '导入失败: ' + error.message;
            } finally {
                spinner.style.display = 'none';
                text.textContent = '导入';
            }
        }

        // Clear zero balance keys - 清除已用尽密钥
        async function clearZeroBalanceKeys(btnEl) {
            const resultEl = document.getElementById('clearZeroResult');

            if (!allData) {
                showToast('请先加载数据', true);
                return;
            }

            const zeroBalanceKeys = allData.data.filter(item => {
                if (item.error) return false;
                const standardMonthly = item.billing?.standard?.monthly?.usedPercent;
                if (typeof standardMonthly === 'number') {
                    return standardMonthly >= 100;
                }
                return (item.totalAllowance - item.orgTotalTokensUsed) <= 0;
            });

            if (zeroBalanceKeys.length === 0) {
                if (resultEl) { resultEl.className = 'import-result success'; resultEl.textContent = '没有已用尽的密钥'; resultEl.style.display = ''; }
                return;
            }

            if (!confirm(\`确定要删除 \${zeroBalanceKeys.length} 个已用尽的密钥吗？此操作不可恢复！\`)) {
                return;
            }

            if (btnEl) { btnEl.disabled = true; btnEl.textContent = '清除中...'; }
            if (resultEl) { resultEl.style.display = 'none'; }

            let successCount = 0;
            let failCount = 0;

            for (const item of zeroBalanceKeys) {
                try {
                    const response = await fetch(\`/api/keys/\${item.id}\`, { method: 'DELETE' });
                    if (response.ok) { successCount++; keyCache.cache.delete(item.id); }
                    else { failCount++; }
                } catch (error) {
                    failCount++;
                }
            }

            if (btnEl) { btnEl.disabled = false; btnEl.textContent = '清除已用尽密钥'; }
            if (resultEl) {
                resultEl.className = failCount > 0 ? 'import-result error' : 'import-result success';
                resultEl.textContent = \`已删除 \${successCount} 个\${failCount > 0 ? \`，\${failCount} 个失败\` : ''}\`;
                resultEl.style.display = '';
            }
            showToast(\`已清除 \${successCount} 个用尽密钥\`);
            loadData();
        }

        // 自动刷新功能
        function initAutoRefresh() {
            // 从 localStorage 加载设置
            const savedInterval = localStorage.getItem('autoRefreshInterval');
            const isEnabled = localStorage.getItem('autoRefreshEnabled');

            if (savedInterval) {
                autoRefreshMinutes = parseInt(savedInterval);
                document.getElementById('refreshInterval').value = autoRefreshMinutes;
            }

            // 默认启用自动刷新
            if (isEnabled === null || isEnabled === 'true') {
                startAutoRefresh();
            } else {
                updateToggleButton(false);
                document.getElementById('autoRefreshStatus').innerHTML = '自动刷新 · 已暂停';
                document.getElementById('headerNextRefresh').textContent = '已暂停';
                document.getElementById('nextRefreshDisplay').textContent = '已暂停';
            }
        }

        function startAutoRefresh() {
            // 清除现有的计时器
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
            }
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }

            // 设置下次刷新时间
            nextRefreshTime = Date.now() + (autoRefreshMinutes * 60 * 1000);

            // 启动自动刷新计时器
            autoRefreshInterval = setInterval(() => {
                console.log('自动刷新数据...');
                loadData();
            }, autoRefreshMinutes * 60 * 1000);

            // 启动倒计时显示
            updateCountdown();
            countdownInterval = setInterval(updateCountdown, 1000);

            // 更新状态显示
            document.getElementById('autoRefreshStatus').innerHTML = '自动刷新 · <span id="headerNextRefresh">计算中...</span>';
            updateToggleButton(true);
            localStorage.setItem('autoRefreshEnabled', 'true');
        }

        function stopAutoRefresh() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            nextRefreshTime = null;
            document.getElementById('nextRefreshDisplay').textContent = '已暂停';
            document.getElementById('headerNextRefresh').textContent = '已暂停';
            document.getElementById('autoRefreshStatus').innerHTML = '自动刷新 · 已暂停';
            updateToggleButton(false);
            localStorage.setItem('autoRefreshEnabled', 'false');
        }

        function resetAutoRefresh() {
            if (autoRefreshInterval) {
                // 如果自动刷新已启用，重置计时器
                startAutoRefresh();
            }
        }

        function updateCountdown() {
            if (!nextRefreshTime) return;

            const now = Date.now();
            const remaining = nextRefreshTime - now;

            if (remaining <= 0) {
                document.getElementById('nextRefreshDisplay').textContent = '正在刷新...';
                document.getElementById('headerNextRefresh').textContent = '正在刷新...';
                return;
            }

            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            const timeText = minutes + ' 分 ' + seconds + ' 秒后';

            document.getElementById('nextRefreshDisplay').textContent = timeText;
            document.getElementById('headerNextRefresh').textContent = timeText;
        }

        function updateToggleButton(isRunning) {
            const btn = document.getElementById('toggleRefreshBtn');
            if (isRunning) {
                btn.textContent = '暂停刷新';
                btn.className = 'import-btn secondary';
            } else {
                btn.textContent = '启动刷新';
                btn.className = 'import-btn success';
            }
        }

        function saveRefreshSettings() {
            const input = document.getElementById('refreshInterval');
            const newInterval = parseInt(input.value);

            if (isNaN(newInterval) || newInterval < 1 || newInterval > 1440) {
                alert('请输入有效的时间间隔（1-1440分钟）');
                return;
            }

            autoRefreshMinutes = newInterval;
            localStorage.setItem('autoRefreshInterval', newInterval.toString());

            // 如果自动刷新正在运行，重启以应用新设置
            if (autoRefreshInterval) {
                startAutoRefresh();
            }

            alert('自动刷新间隔已设置为 ' + newInterval + ' 分钟');
        }

        function toggleAutoRefresh() {
            if (autoRefreshInterval) {
                stopAutoRefresh();
            } else {
                startAutoRefresh();
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            const pageSizeSelect = document.getElementById('pageSizeSelect');
            if (pageSizeSelect) {
                const selectValue = itemsPerPage === Infinity ? 'all' : String(itemsPerPage);
                if (pageSizeSelect.value !== selectValue) {
                    pageSizeSelect.value = selectValue;
                }
            }

            loadData();
            initAutoRefresh();
        });
    </script>
</body>
</html>
`;

// Continue with API functions...
const LIMIT_WINDOWS = ["fiveHour", "weekly", "monthly"];
const LIMIT_GROUPS = ["standard", "core"];

function normalizeLimitWindow(raw: any) {
  return {
    usedPercent: Number(raw?.usedPercent ?? 0),
    windowEnd: raw?.windowEnd ?? null,
    secondsRemaining: typeof raw?.secondsRemaining === "number" ? raw.secondsRemaining : null,
  };
}

function normalizeLimitGroup(raw: any) {
  return {
    fiveHour: normalizeLimitWindow(raw?.fiveHour),
    weekly: normalizeLimitWindow(raw?.weekly),
    monthly: normalizeLimitWindow(raw?.monthly),
  };
}

function normalizeBillingLimits(apiData: any) {
  const limits = apiData?.limits ?? {};
  return {
    usesTokenRateLimitsBilling: Boolean(apiData?.usesTokenRateLimitsBilling),
    standard: normalizeLimitGroup(limits.standard),
    core: normalizeLimitGroup(limits.core),
    extraUsageBalanceCents: Number(apiData?.extraUsageBalanceCents ?? 0),
    extraUsageAllowed: Boolean(apiData?.extraUsageAllowed),
    overagePreference: apiData?.overagePreference ?? null,
    tokenRateLimitsRolloutEligible: Boolean(apiData?.tokenRateLimitsRolloutEligible),
  };
}

function formatIsoDate(value: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return date.toISOString().split("T")[0];
}

function summarizeLimitWindow(results: any[], group: string, windowName: string) {
  const values = results
    .map(item => item.billing?.[group]?.[windowName]?.usedPercent)
    .filter(value => typeof value === "number" && Number.isFinite(value));

  const count = values.length;
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    avgUsedPercent: count > 0 ? total / count : 0,
    maxUsedPercent: count > 0 ? Math.max(...values) : 0,
    nearLimitCount: values.filter(value => value >= 80).length,
    exhaustedCount: values.filter(value => value >= 100).length,
  };
}

function buildBillingTotals(results: any[]) {
  const totals: any = {
    keyCount: results.length,
    usesTokenRateLimitsBillingCount: results.filter(item => item.billing?.usesTokenRateLimitsBilling).length,
    extra: {
      extraUsageAllowedCount: results.filter(item => item.billing?.extraUsageAllowed).length,
      extraUsageBalanceCentsTotal: results.reduce((sum, item) => sum + (item.billing?.extraUsageBalanceCents || 0), 0),
      overageEnabledCount: results.filter(item => Boolean(item.billing?.overagePreference)).length,
    },
  };

  LIMIT_GROUPS.forEach(group => {
    totals[group] = {};
    LIMIT_WINDOWS.forEach(windowName => {
      totals[group][windowName] = summarizeLimitWindow(results, group, windowName);
    });
  });

  return totals;
}

async function fetchApiKeyData(id: string, key: string) {
  try {
    const [billingResponse, usageResponse] = await Promise.all([
      fetch("https://api.factory.ai/api/billing/limits", {
        headers: {
          "Authorization": `Bearer ${key}`,
          "X-Factory-Client": "cli",
          "User-Agent": "Bun/1.3.13",
          "Accept": "*/*",
        },
      }),
      fetch("https://app.factory.ai/api/organization/members/chat-usage", {
        headers: {
          "Authorization": `Bearer ${key}`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        },
      }).catch(() => null),
    ]);

    if (!billingResponse.ok) {
      const errorBody = await billingResponse.text();
      console.error(`Error fetching billing limits for key ID ${id}: ${billingResponse.status} ${errorBody}`);
      return { id, key: `${key.substring(0, 4)}...`, error: `HTTP ${billingResponse.status}` };
    }

    const apiData = await billingResponse.json();
    if (!apiData.limits || !apiData.limits.standard) {
      return { id, key: `${key.substring(0, 4)}...`, error: "Invalid API response structure" };
    }

    const billing = normalizeBillingLimits(apiData);
    const standardMonthlyUsedPercent = billing.standard.monthly.usedPercent;
    const maskedKey = `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;

    let orgTotalTokensUsed = 0;
    let totalAllowance = 0;
    let startDate = "N/A";
    let endDate = formatIsoDate(billing.standard.monthly.windowEnd);

    if (usageResponse && usageResponse.ok) {
      try {
        const usageData = await usageResponse.json();
        if (usageData.usage?.standard) {
          const std = usageData.usage.standard;
          orgTotalTokensUsed = std.orgTotalTokensUsed ?? 0;
          totalAllowance = std.totalAllowance ?? 0;
          if (usageData.usage.startDate) {
            startDate = new Date(usageData.usage.startDate).toISOString().split("T")[0];
          }
          if (usageData.usage.endDate) {
            endDate = new Date(usageData.usage.endDate).toISOString().split("T")[0];
          }
        }
      } catch (_) {
        // ignore usage API parse errors
      }
    }

    return {
      id,
      key: maskedKey,
      startDate,
      endDate,
      orgTotalTokensUsed,
      totalAllowance,
      usedRatio: totalAllowance > 0 ? orgTotalTokensUsed / totalAllowance : standardMonthlyUsedPercent / 100,
      billing,
    };
  } catch (error) {
    console.error(`Failed to process key ID ${id}:`, error);
    return { id, key: `${key.substring(0, 4)}...`, error: "Failed to fetch" };
  }
}

async function getAggregatedData() {
  const keyEntries = await getAllApiKeys();

  if (keyEntries.length === 0) {
    throw new Error("No API keys found in storage. Please import keys first.");
  }

  const results = await Promise.all(keyEntries.map(entry => fetchApiKeyData(entry.id, entry.key)));
  const validResults = results.filter(r => !r.error);

  const totals = validResults.reduce((acc, res) => {
    acc.total_orgTotalTokensUsed += res.orgTotalTokensUsed || 0;
    acc.total_totalAllowance += res.totalAllowance || 0;
    acc.total_tokensRemaining += Math.max((res.totalAllowance || 0) - (res.orgTotalTokensUsed || 0), 0);
    return acc;
  }, {
    total_orgTotalTokensUsed: 0,
    total_totalAllowance: 0,
    total_tokensRemaining: 0,
  });

  const billingTotals = buildBillingTotals(validResults);
  const beijingTime = new Date(Date.now() + 8 * 60 * 60 * 1000);

  const keysWithBalance = validResults.filter(r => {
    const standardMonthly = r.billing?.standard?.monthly?.usedPercent ?? 100;
    return standardMonthly < 100;
  });

  if (keysWithBalance.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("📋 Standard Monthly 未用尽的API Keys:");
    console.log("-".repeat(80));
    keysWithBalance.forEach(item => {
      const originalEntry = keyEntries.find(e => e.id === item.id);
      if (originalEntry) {
        console.log(originalEntry.key);
      }
    });
    console.log("=".repeat(80) + "\n");
  } else {
    console.log("\n⚠️  没有 Standard Monthly 未用尽的API Keys\n");
  }

  return {
    update_time: format(beijingTime, "yyyy-MM-dd HH:mm:ss"),
    total_count: keyEntries.length,
    totals,
    billingTotals,
    data: results,
  };
}

// Main HTTP request handler
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // Login endpoint
  if (url.pathname === "/api/login" && req.method === "POST") {
    try {
      const body = await req.json();
      const { password } = body;

      if (password === ADMIN_PASSWORD) {
        const sessionId = await createSession();
        const response = new Response(JSON.stringify({ success: true }), { headers });

        setCookie(response.headers, {
          name: "session",
          value: sessionId,
          maxAge: 7 * 24 * 60 * 60, // 7 days
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        });

        return response;
      } else {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401,
          headers,
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers,
      });
    }
  }

  // Show login page if password is set and not authenticated
  if (ADMIN_PASSWORD && url.pathname === "/") {
    const authenticated = await isAuthenticated(req);
    if (!authenticated) {
      return new Response(LOGIN_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  // Home page
  if (url.pathname === "/") {
    return new Response(HTML_CONTENT, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // Protected routes - require authentication
  const authenticated = await isAuthenticated(req);
  if (ADMIN_PASSWORD && !authenticated) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers,
    });
  }

  // Get usage data
  if (url.pathname === "/api/data") {
    try {
      const data = await getAggregatedData();
      return new Response(JSON.stringify(data), { headers });
    } catch (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers,
      });
    }
  }

  // Get all keys
  if (url.pathname === "/api/keys" && req.method === "GET") {
    try {
      const keys = await getAllApiKeys();
      const safeKeys = keys.map(k => ({
        id: k.id,
        name: k.name,
        createdAt: k.createdAt,
        masked: `${k.key.substring(0, 4)}...${k.key.substring(k.key.length - 4)}`
      }));
      return new Response(JSON.stringify(safeKeys), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers,
      });
    }
  }

  // Batch import keys
  if (url.pathname === "/api/keys/import" && req.method === "POST") {
    try {
      const body = await req.json();
      const keys = body.keys as string[];

      if (!Array.isArray(keys)) {
        return new Response(JSON.stringify({ error: "Invalid request: 'keys' must be an array" }), {
          status: 400,
          headers,
        });
      }

      const result = await batchImportKeys(keys);
      return new Response(JSON.stringify(result), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers,
      });
    }
  }

  // Get full API key by ID
  if (url.pathname.match(/^\/api\/keys\/[^\/]+\/full$/) && req.method === "GET") {
    try {
      const parts = url.pathname.split("/");
      const id = parts[3];
      if (!id) {
        return new Response(JSON.stringify({ error: "Key ID required" }), {
          status: 400,
          headers,
        });
      }

      const keyEntry = await getApiKey(id);
      if (!keyEntry) {
        return new Response(JSON.stringify({ error: "Key not found" }), {
          status: 404,
          headers,
        });
      }

      return new Response(JSON.stringify({ id: keyEntry.id, key: keyEntry.key }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers,
      });
    }
  }

  // Batch delete keys
  if (url.pathname === "/api/keys/batch-delete" && req.method === "POST") {
    try {
      const body = await req.json();
      const ids = body.ids as string[];

      if (!Array.isArray(ids) || ids.length === 0) {
        return new Response(JSON.stringify({ error: "Invalid request: 'ids' must be a non-empty array" }), {
          status: 400,
          headers,
        });
      }

      const result = await batchDeleteKeys(ids);
      return new Response(JSON.stringify(result), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers,
      });
    }
  }

  // Delete a key
  if (url.pathname.startsWith("/api/keys/") && req.method === "DELETE") {
    try {
      const id = url.pathname.split("/").pop();
      if (!id || id === "batch-delete") {
        return new Response(JSON.stringify({ error: "Key ID required" }), {
          status: 400,
          headers,
        });
      }

      await deleteApiKey(id);
      return new Response(JSON.stringify({ success: true }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers,
      });
    }
  }

  // Add a single key
  if (url.pathname === "/api/keys" && req.method === "POST") {
    try {
      const body = await req.json();
      const { key, name } = body;

      if (!key) {
        return new Response(JSON.stringify({ error: "Key is required" }), {
          status: 400,
          headers,
        });
      }

      const id = `key-${Date.now()}`;
      await saveApiKey(id, key, name);
      return new Response(JSON.stringify({ success: true, id }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers,
      });
    }
  }

  return new Response("Not Found", { status: 404 });
}

console.log("🚀 Server running on http://localhost:8000");
console.log(`🔐 Password Protection: ${ADMIN_PASSWORD ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
serve(handler);
