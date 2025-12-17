// main.ts - Optimized by Apple Senior Engineer
import { serve } from "https://deno.land/std@0.182.0/http/server.ts";
import { format } from "https://deno.land/std@0.182.0/datetime/mod.ts";
import { setCookie, getCookies } from "https://deno.land/std@0.182.0/http/cookie.ts";

// Initialize Deno KV
const kv = await Deno.openKv();

// Get admin password from environment variable
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD");

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
    <title>登录 - API 余额监控看板</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif;
            background: linear-gradient(135deg, #007AFF 0%, #5856D6 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            transition: background 0.35s ease;
        }

        /* Dark mode for login page body */
        body[data-theme="dark"] {
            background: linear-gradient(135deg, #0A84FF 0%, #6C5CE7 100%);
        }

        .login-container {
            background: white;
            border-radius: 24px;
            padding: 48px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 400px;
            width: 100%;
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            transition: background 0.35s ease, color 0.35s ease;
        }

        /* Dark mode styles for login page */
        body[data-theme="dark"] .login-container {
            background: #1C1C1E;
            color: #F5F5F7;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
        }

        body[data-theme="dark"] .login-container h1 {
            color: #F5F5F7;
        }

        body[data-theme="dark"] .login-container p {
            color: #98989D;
        }

        body[data-theme="dark"] label {
            color: #F5F5F7;
        }

        body[data-theme="dark"] input[type="password"] {
            background: #2C2C2E;
            color: #F5F5F7;
            border-color: rgba(255, 255, 255, 0.12);
        }

        body[data-theme="dark"] input[type="password"]:focus {
            border-color: #0A84FF;
            box-shadow: 0 0 0 4px rgba(10, 132, 255, 0.2);
        }

        body[data-theme="dark"] .login-btn {
            background: #0A84FF;
        }

        body[data-theme="dark"] .login-btn:hover {
            box-shadow: 0 8px 20px rgba(10, 132, 255, 0.3);
        }

        /* Theme toggle for login page */
        .login-theme-toggle {
            position: fixed;
            top: 24px;
            right: 24px;
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            cursor: pointer;
            transition: all 0.2s ease;
            color: white;
        }

        .login-theme-toggle:hover {
            transform: scale(1.1);
            background: rgba(255, 255, 255, 0.3);
        }

        body[data-theme="dark"] .login-theme-toggle {
            background: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.2);
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(40px) scale(0.95);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        .login-icon {
            font-size: 64px;
            text-align: center;
            margin-bottom: 24px;
        }

        h1 {
            font-size: 28px;
            font-weight: 700;
            text-align: center;
            color: #1D1D1F;
            margin-bottom: 12px;
            letter-spacing: -0.5px;
        }

        p {
            text-align: center;
            color: #86868B;
            margin-bottom: 32px;
            font-size: 15px;
        }

        .form-group {
            margin-bottom: 24px;
        }

        label {
            display: block;
            font-size: 13px;
            font-weight: 600;
            color: #1D1D1F;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        input[type="password"] {
            width: 100%;
            padding: 16px;
            border: 1.5px solid rgba(0, 0, 0, 0.06);
            border-radius: 12px;
            font-size: 16px;
            transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }

        input[type="password"]:focus {
            outline: none;
            border-color: #007AFF;
            box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.1);
        }

        .login-btn {
            width: 100%;
            padding: 16px;
            background: #007AFF;
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .login-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0, 122, 255, 0.3);
        }

        .login-btn:active {
            transform: translateY(0);
        }

        .error-message {
            background: rgba(255, 59, 48, 0.1);
            color: #FF3B30;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 14px;
            margin-bottom: 16px;
            border: 1px solid rgba(255, 59, 48, 0.2);
            display: none;
        }

        .error-message.show {
            display: block;
            animation: shake 0.4s;
        }

        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
        }
    </style>
</head>
<body>
    <button class="login-theme-toggle" id="loginThemeToggle" onclick="toggleLoginTheme()">🌙</button>
    <div class="login-container">
        <div class="login-icon">🔐</div>
        <h1>欢迎回来</h1>
        <p>请输入管理员密码以访问系统</p>

        <div class="error-message" id="errorMessage">
            密码错误，请重试
        </div>

        <form onsubmit="handleLogin(event)">
            <div class="form-group">
                <label for="password">密码</label>
                <input
                    type="password"
                    id="password"
                    placeholder="输入密码"
                    autocomplete="current-password"
                    required
                >
            </div>

            <button type="submit" class="login-btn">
                登录
            </button>
        </form>
    </div>

    <script>
        // Initialize theme on page load
        const THEME_STORAGE_KEY = 'themeMode';

        function initTheme() {
            const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const theme = savedTheme || (prefersDark ? 'dark' : 'light');

            if (theme === 'dark') {
                document.body.setAttribute('data-theme', 'dark');
            }

            // Update theme toggle button
            updateLoginThemeButton();
        }

        function updateLoginThemeButton() {
            const btn = document.getElementById('loginThemeToggle');
            if (btn) {
                const isDark = document.body.getAttribute('data-theme') === 'dark';
                btn.textContent = isDark ? '☀️' : '🌙';
            }
        }

        function toggleLoginTheme() {
            const isDark = document.body.getAttribute('data-theme') === 'dark';
            const newTheme = isDark ? 'light' : 'dark';

            document.body.setAttribute('data-theme', newTheme);
            localStorage.setItem(THEME_STORAGE_KEY, newTheme);

            if (newTheme === 'dark') {
                document.body.setAttribute('data-theme', 'dark');
            } else {
                document.body.removeAttribute('data-theme');
            }

            updateLoginThemeButton();
        }

        // Call initTheme as soon as the body element exists
        if (document.body) {
            initTheme();
        } else {
            document.addEventListener('DOMContentLoaded', initTheme);
        }

        async function handleLogin(event) {
            event.preventDefault();

            const password = document.getElementById('password').value;
            const errorMessage = document.getElementById('errorMessage');

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password }),
                });

                if (response.ok) {
                    window.location.href = '/';
                } else {
                    errorMessage.classList.add('show');
                    document.getElementById('password').value = '';
                    document.getElementById('password').focus();

                    setTimeout(() => {
                        errorMessage.classList.remove('show');
                    }, 3000);
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
    <title>Droid API 余额监控看板</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500;600;700&family=Bebas+Neue&display=swap" rel="stylesheet">
    <style>
        /* Apple-inspired Design System with FiraCode */
        :root {
            /* Light Mode (Default) */
            --color-primary: #007AFF;
            --color-secondary: #5856D6;
            --color-success: #34C759;
            --color-warning: #FF9500;
            --color-danger: #FF3B30;
            --color-bg: #F5F5F7;
            --color-surface: #FFFFFF;
            --color-text-primary: #1D1D1F;
            --color-text-secondary: #86868B;
            --color-border: rgba(0, 0, 0, 0.06);
            --color-shadow: rgba(0, 0, 0, 0.08);

            /* Skip List - Keep light mode for UI elements in dark mode */
            --skip-list-bg: #F5F5F7;

            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 18px;
            --radius-xl: 24px;
            --spacing-xs: 8px;
            --spacing-sm: 12px;
            --spacing-md: 16px;
            --spacing-lg: 24px;
            --spacing-xl: 32px;
            --transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Dark Mode */
        :root[data-theme="dark"] {
            --color-primary: #0A84FF;
            --color-secondary: #6C5CE7;
            --color-success: #30D158;
            --color-warning: #FF9F0A;
            --color-danger: #FF453A;
            --color-bg: #000000;
            --color-surface: #1C1C1E;
            --color-text-primary: #F5F5F7;
            --color-text-secondary: #98989D;
            --color-border: rgba(255, 255, 255, 0.12);
            --color-shadow: rgba(0, 0, 0, 0.4);

            /* Skip List - Keep light mode for UI elements in dark mode */
            --skip-list-bg: #2C2C2E;
        }

        /* Dark mode for login page */
        :root[data-theme="dark"] .login-container {
            background: #1C1C1E;
            color: #F5F5F7;
        }

        :root[data-theme="dark"] .login-container h1,
        :root[data-theme="dark"] .login-container label {
            color: #F5F5F7;
        }

        :root[data-theme="dark"] .login-container p {
            color: #98989D;
        }

        :root[data-theme="dark"] input[type="password"] {
            background: #2C2C2E;
            color: #F5F5F7;
            border-color: rgba(255, 255, 255, 0.12);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI', sans-serif;
            background: var(--color-bg);
            min-height: 100vh;
            padding: var(--spacing-lg);
            color: var(--color-text-primary);
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
        }

        /* FiraCode for code/numbers - Scale 1.25x and anti-aliasing */
        .code-font, .key-cell, td.number, .key-masked, #importKeys {
            font-family: 'Fira Code', 'SF Mono', 'Monaco', 'Courier New', monospace;
            font-feature-settings: "liga" 1, "calt" 1;
            -webkit-font-smoothing: subpixel-antialiased;
            -moz-osx-font-smoothing: auto;
            text-rendering: optimizeLegibility;
        }

        .container {
            max-width: 2400px;
            margin: 0 auto;
            background: var(--color-surface);
            border-radius: var(--radius-xl);
            box-shadow: 0 8px 30px var(--color-shadow);
            overflow: hidden;
        }

        .header {
            position: relative;
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
            padding: var(--spacing-lg) var(--spacing-lg);
            text-align: center;
        }

        .header h1 {
            font-size: 32px;
            font-weight: 700;
            letter-spacing: -0.5px;
            margin-bottom: 6px;
        }

        .header .update-time {
            font-size: 15px;
            opacity: 0.85;
            font-weight: 400;
        }

        .stats-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: var(--spacing-lg);
            padding: var(--spacing-xl);
            background: var(--color-bg);
        }

        .stat-card {
            background: var(--color-surface);
            border-radius: var(--radius-lg);
            padding: calc(var(--spacing-lg) * 1.25);
            text-align: center;
            border: 1px solid var(--color-border);
            transition: var(--transition);
            position: relative;
            overflow: hidden;
        }

        .stat-card:hover {
            transform: translateY(-4px) scale(1.02);
            box-shadow: 0 12px 40px var(--color-shadow);
        }

        .stat-card .label {
            font-size: 18px;
            color: var(--color-text-secondary);
            margin-bottom: var(--spacing-sm);
            font-weight: 500;
            letter-spacing: 0.3px;
            text-transform: uppercase;
            position: relative;
            z-index: 2;
        }

        .stat-card .value {
            font-size: 56px;
            font-weight: 600;
            background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'San Francisco', sans-serif;
            font-variant-numeric: tabular-nums;
            position: relative;
            z-index: 2;
        }

        /* 进度条背景 */
        .stat-card .progress-background {
            position: absolute;
            bottom: 0;
            left: 0;
            height: 100%;
            background: linear-gradient(135deg, rgba(0, 122, 255, 0.15) 0%, rgba(88, 86, 214, 0.15) 100%);
            transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1;
            border-radius: var(--radius-lg);
        }

        .stat-card .progress-background::after {
            content: '';
            position: absolute;
            top: 0;
            right: 0;
            width: 2px;
            height: 100%;
            background: linear-gradient(180deg, transparent 0%, rgba(0, 122, 255, 0.6) 50%, transparent 100%);
            box-shadow: 0 0 8px rgba(0, 122, 255, 0.4);
        }

        .table-container {
            padding: 0 var(--spacing-xl) var(--spacing-xl);
            overflow-x: visible;
        }

        .table-controls {
            margin: 1rem;
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: var(--spacing-md);
            margin-bottom: var(--spacing-md);
            flex-wrap: wrap;
        }

        .page-size-control {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            font-size: 14px;
            color: var(--color-text-secondary);
        }

        .page-size-select {
            padding: 0.5rem 1rem;
            border: 1px solid rgba(0, 0, 0, 0.12);
            border-radius: var(--radius-md);
            background: var(--color-surface);
            color: var(--color-text);
            font-size: 14px;
            transition: var(--transition);
        }

        .page-size-select:focus {
            outline: none;
            border-color: var(--color-primary);
            box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.2);
        }

        table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            background: var(--color-surface);
            border-radius: var(--radius-md);
            overflow: visible;
            border: 1px solid rgba(0, 0, 0, 0.08);
            margin-bottom: var(--spacing-xl);
            table-layout: fixed;
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
        }

        thead {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
        }

        th {
            padding: 22px var(--spacing-md);
            text-align: left;
            font-weight: 700;
            font-size: 13px;
            white-space: nowrap;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            border-bottom: 2px solid rgba(255, 255, 255, 0.2);
        }

        th.number { text-align: right; }

        /* 调整列宽 */
        th:nth-child(1) { width: 50px; } /* 复选框 */
        th:nth-child(2) { width: 5%; } /* ID */
        th:nth-child(3) { width: 9%; } /* API Key */
        th:nth-child(4) { width: 9%; } /* 开始时间 */
        th:nth-child(5) { width: 9%; } /* 结束时间 */
        th:nth-child(6) { width: 12%; } /* 总计额度 */
        th:nth-child(7) { width: 12%; } /* 已使用 */
        th:nth-child(8) { width: 12%; } /* 剩余额度 */
        th:nth-child(9) { width: 10%; } /* 使用百分比 */
        th:nth-child(10) { width: 10%; } /* 操作 */

        td {
            padding: 22px var(--spacing-md);
            border-bottom: 1px solid var(--color-border);
            font-size: 15px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            vertical-align: middle;
        }

        td.number {
            text-align: right;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'San Francisco', system-ui, sans-serif;
            font-size: 18px;
            letter-spacing: 0.3px;
        }

        td.error-row { color: var(--color-danger); }

        tbody tr { 
            transition: all 0.2s ease;
            border-left: 3px solid transparent;
        }
        tbody tr:hover { 
            background-color: rgba(0, 122, 255, 0.05);
            border-left-color: var(--color-primary);
        }
        tbody tr:last-child td { border-bottom: none; }

        /* 总计行样式 - 独特颜色 */
        .total-row {
            background: linear-gradient(135deg, rgba(0, 122, 255, 0.12) 0%, rgba(88, 86, 214, 0.12) 100%);
            font-weight: 700;
            position: sticky;
            top: 0;
            z-index: 10;
            border-top: 2px solid var(--color-primary);
            border-bottom: 3px solid var(--color-primary) !important;
            box-shadow: 0 2px 8px rgba(0, 122, 255, 0.1);
        }

        .total-row td {
            padding: 24px var(--spacing-md);
            font-size: 16px;
            color: var(--color-primary);
            border-bottom: 3px solid var(--color-primary) !important;
            font-weight: 700;
            letter-spacing: 0.3px;
        }

        .total-row td.number {
            font-size: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'San Francisco', system-ui, sans-serif;
            font-weight: 600;
            letter-spacing: 0.3px;
        }

        /* 按钮组容器 */
        .action-buttons {
            display: flex;
            gap: 8px;
            justify-content: center;
            align-items: center;
        }

        /* 按钮图标样式 */
        .btn-icon {
            width: 18px;
            height: 18px;
            display: inline-block;
            vertical-align: middle;
            filter: brightness(0) invert(1);
        }

        /* 复制按钮样式 */
        .table-copy-btn {
            background: var(--color-primary);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 10px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0, 122, 255, 0.2);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
        }

        .table-copy-btn:hover {
            background: #0056D2;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 122, 255, 0.3);
        }

        .table-copy-btn:active {
            transform: translateY(0);
        }

        .table-copy-btn.copied {
            background: var(--color-success);
            box-shadow: 0 2px 6px rgba(52, 199, 89, 0.3);
        }

        /* 删除按钮样式 */
        .table-delete-btn {
            background: var(--color-danger);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 10px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(255, 59, 48, 0.2);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
        }

        .table-delete-btn:hover {
            background: #D32F2F;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(255, 59, 48, 0.3);
        }

        .table-delete-btn:active {
            transform: translateY(0);
        }

        /* 批量操作相关样式 */
        .checkbox-cell {
            width: 50px;
            text-align: center;
            padding: 22px 12px !important;
        }

        .checkbox-cell input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
            accent-color: var(--color-primary);
        }

        .batch-toolbar {
            position: sticky;
            top: 0;
            z-index: 200;
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
            padding: var(--spacing-md) var(--spacing-lg);
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
            justify-content: space-between;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
            border-radius: var(--radius-md);
            margin-bottom: var(--spacing-md);
        }

        .batch-toolbar-left {
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
        }

        .batch-toolbar-right {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
        }

        .batch-count {
            font-size: 16px;
            font-weight: 600;
        }

        .batch-btn {
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: var(--radius-sm);
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            white-space: nowrap;
        }

        .batch-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }

        .batch-btn.danger {
            background: var(--color-danger);
            border: 1px solid rgba(255, 255, 255, 0.3);
        }

        .batch-btn.danger:hover {
            background: #D32F2F;
        }

        /* Toast 提示样式 */
        .toast {
            position: fixed;
            top: var(--spacing-xl);
            right: var(--spacing-xl);
            background: var(--color-surface);
            color: var(--color-text-primary);
            padding: var(--spacing-md) var(--spacing-lg);
            border-radius: var(--radius-md);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            z-index: 10000;
            animation: slideInRight 0.3s ease, fadeOut 0.3s ease 2.7s;
            border-left: 4px solid var(--color-success);
        }

        .toast.error {
            border-left-color: var(--color-danger);
        }

        @keyframes slideInRight {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }

        .toast-icon {
            font-size: 20px;
        }

        .toast-message {
            font-size: 15px;
            font-weight: 500;
        }

        .key-cell {
            font-size: 20px;
            color: var(--color-text-secondary);
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: 'Fira Code', monospace;
            font-weight: 500;
            background: rgba(0, 0, 0, 0.02);
            padding: 8px 12px !important;
            border-radius: 6px;
        }

        .id-cell {
            font-size: 20px;
            color: var(--color-text-secondary);
            font-weight: 500;
            font-family: 'Fira Code', monospace;
        }

        .date-cell {
            font-size: 20px;
            color: var(--color-text-primary);
            font-weight: 400;
        }

        .refresh-btn {
            position: fixed;
            bottom: var(--spacing-xl);
            right: var(--spacing-xl);
            background: var(--color-primary);
            color: white;
            border: none;
            border-radius: 100px;
            padding: 16px 28px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 8px 24px rgba(0, 122, 255, 0.35);
            transition: var(--transition);
            display: flex;
            align-items: center;
            gap: var(--spacing-xs);
            z-index: 100;
        }

        .refresh-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 32px rgba(0, 122, 255, 0.45);
        }

        .refresh-btn:active {
            transform: translateY(-1px);
        }

        .clear-zero-btn {
            position: fixed;
            bottom: calc(var(--spacing-xl) + 70px);
            right: var(--spacing-xl);
            background: var(--color-danger);
            color: white;
            border: none;
            border-radius: 100px;
            padding: 16px 28px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 8px 24px rgba(255, 59, 48, 0.35);
            transition: var(--transition);
            display: flex;
            align-items: center;
            gap: var(--spacing-xs);
            z-index: 100;
        }

        .clear-zero-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 32px rgba(255, 59, 48, 0.45);
        }

        .clear-zero-btn:active {
            transform: translateY(-1px);
        }

        .loading {
            text-align: center;
            padding: 60px 20px;
            color: var(--color-text-secondary);
            font-size: 15px;
        }

        .error {
            text-align: center;
            padding: 60px 20px;
            color: var(--color-danger);
            font-size: 15px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .spinner {
            display: inline-block;
            width: 18px;
            height: 18px;
            border: 2.5px solid rgba(255, 255, 255, 0.25);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 0.8s linear infinite;
        }

        .theme-toggle-btn {
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 100px;
            padding: 8px 12px;
            font-size: 16px;
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
        }

        .theme-toggle-btn:hover {
            background: rgba(255, 255, 255, 0.25);
            transform: scale(1.1);
        }

        .manage-btn {
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 100px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
        }

        .manage-btn:hover {
            background: rgba(255, 255, 255, 0.25);
            transform: scale(1.05);
        }

        /* Dark mode overlay styles for header buttons */
        :root[data-theme="dark"] .theme-toggle-btn,
        :root[data-theme="dark"] .manage-btn {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.15);
        }

        :root[data-theme="dark"] .theme-toggle-btn:hover,
        :root[data-theme="dark"] .manage-btn:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .manage-panel {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(10px);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--spacing-lg);
            animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        .manage-content {
            background: var(--color-surface);
            border-radius: var(--radius-xl);
            max-width: 1000px;
            width: 100%;
            max-height: 85vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(40px) scale(0.95);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        .manage-header {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
            color: white;
            padding: var(--spacing-lg) var(--spacing-xl);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .manage-header h2 {
            margin: 0;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.3px;
        }

        .close-btn {
            position: absolute;
            top: var(--spacing-md);
            right: var(--spacing-md);
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            border: none;
            color: white;
            font-size: 22px;
            cursor: pointer;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: var(--transition);
            z-index: 10;
        }

        .close-btn:hover {
            background: rgba(255, 255, 255, 0.25);
            transform: rotate(90deg);
        }

        .manage-body {
            padding: var(--spacing-xl);
            overflow-y: auto;
            flex: 1;
        }

        .import-section {
            margin-bottom: 0;
        }

        .import-section h3 {
            margin: 0 0 var(--spacing-md) 0;
            font-size: 22px;
            font-weight: 600;
            color: var(--color-text-primary);
            letter-spacing: -0.3px;
        }

        #importKeys {
            width: 100%;
            padding: var(--spacing-md);
            border: 1.5px solid var(--color-border);
            border-radius: var(--radius-md);
            font-size: 15px;
            resize: vertical;
            transition: var(--transition);
            line-height: 1.8;
            min-height: 150px;
        }

        #importKeys:focus {
            outline: none;
            border-color: var(--color-primary);
            box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.1);
        }

        .import-btn {
            margin-top: var(--spacing-md);
            background: var(--color-primary);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            padding: 12px 24px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            display: inline-flex;
            align-items: center;
            gap: var(--spacing-xs);
        }

        .import-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0, 122, 255, 0.3);
        }

        .import-btn:active {
            transform: translateY(0);
        }

        .import-result {
            margin-top: var(--spacing-md);
            padding: var(--spacing-md);
            border-radius: var(--radius-sm);
            font-size: 14px;
            font-weight: 500;
        }

        .import-result.success {
            background: rgba(52, 199, 89, 0.1);
            color: var(--color-success);
            border: 1px solid rgba(52, 199, 89, 0.2);
        }

        .import-result.error {
            background: rgba(255, 59, 48, 0.1);
            color: var(--color-danger);
            border: 1px solid rgba(255, 59, 48, 0.2);
        }

        .keys-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .keys-list::-webkit-scrollbar {
            width: 8px;
        }

        .keys-list::-webkit-scrollbar-track {
            background: transparent;
        }

        .keys-list::-webkit-scrollbar-thumb {
            background: var(--color-border);
            border-radius: 100px;
        }

        .keys-list::-webkit-scrollbar-thumb:hover {
            background: var(--color-text-secondary);
        }

        /* 分页样式 */
        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: var(--spacing-sm);
            margin-top: var(--spacing-lg);
            padding: var(--spacing-lg) 0;
        }

        .pagination-btn {
            background: var(--color-surface);
            color: var(--color-text-primary);
            border: 1.5px solid var(--color-border);
            border-radius: var(--radius-sm);
            padding: 10px 16px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            min-width: 40px;
        }

        .pagination-btn:hover:not(:disabled) {
            background: var(--color-primary);
            color: white;
            border-color: var(--color-primary);
            transform: translateY(-2px);
        }

        .pagination-btn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
        }

        .pagination-btn.active {
            background: var(--color-primary);
            color: white;
            border-color: var(--color-primary);
        }

        .pagination-info {
            font-size: 16px;
            color: var(--color-text-secondary);
            font-weight: 500;
            padding: 0 var(--spacing-md);
        }

        .key-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: calc(var(--spacing-md) * 1.25);
            background: var(--color-bg);
            border-radius: var(--radius-md);
            margin-bottom: var(--spacing-sm);
            transition: var(--transition);
            border: 1px solid transparent;
        }

        .key-item:hover {
            background: rgba(0, 122, 255, 0.04);
            border-color: rgba(0, 122, 255, 0.1);
        }

        .key-info { flex: 1; }

        .key-id {
            font-weight: 600;
            color: var(--color-text-primary);
            font-size: 16px;
            margin-bottom: 6px;
        }

        .key-masked {
            color: var(--color-text-secondary);
            font-size: 14px;
        }

        .delete-btn {
            background: var(--color-danger);
            color: white;
            border: none;
            border-radius: var(--radius-sm);
            padding: 10px 18px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
        }

        .delete-btn:hover {
            background: #D32F2F;
            transform: scale(1.05);
        }

        .delete-btn:active {
            transform: scale(0.98);
        }

        /* 卡片视图样式 */
        .view-toggle {
            display: flex;
            gap: var(--spacing-sm);
            margin-bottom: var(--spacing-md);
        }

        .view-toggle-btn {
            background: var(--color-surface);
            color: var(--color-text-secondary);
            border: 1.5px solid var(--color-border);
            border-radius: var(--radius-sm);
            padding: 10px 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            gap: var(--spacing-xs);
        }

        .view-toggle-btn:hover {
            border-color: var(--color-primary);
            color: var(--color-primary);
        }

        .view-toggle-btn.active {
            background: var(--color-primary);
            color: white;
            border-color: var(--color-primary);
        }

        .cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
            gap: var(--spacing-lg);
            padding: 0;
        }

        .key-card {
            background: var(--color-surface);
            border: 2px solid var(--color-border);
            border-radius: var(--radius-lg);
            padding: var(--spacing-lg);
            transition: var(--transition);
            position: relative;
            overflow: hidden;
        }

        .key-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 40px var(--color-shadow);
            border-color: var(--color-primary);
        }

        .key-card.selected {
            border-color: var(--color-primary);
            background: rgba(0, 122, 255, 0.02);
        }

        .key-card-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: var(--spacing-md);
            gap: var(--spacing-md);
        }

        .key-card-checkbox {
            width: 20px;
            height: 20px;
            cursor: pointer;
            accent-color: var(--color-primary);
            flex-shrink: 0;
        }

        .key-card-id {
            font-size: 14px;
            color: var(--color-text-secondary);
            font-weight: 600;
            font-family: 'Fira Code', monospace;
            flex: 1;
        }

        .key-card-status {
            padding: 4px 12px;
            border-radius: 100px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .key-card-status.status-good {
            background: rgba(52, 199, 89, 0.15);
            color: var(--color-success);
        }

        .key-card-status.status-warning {
            background: rgba(255, 149, 0, 0.15);
            color: var(--color-warning);
        }

        .key-card-status.status-danger {
            background: rgba(255, 59, 48, 0.15);
            color: var(--color-danger);
        }

        .key-card-key {
            font-family: 'Fira Code', monospace;
            font-size: 16px;
            color: var(--color-text-primary);
            background: var(--color-bg);
            padding: 12px;
            border-radius: var(--radius-sm);
            margin-bottom: var(--spacing-md);
            word-break: break-all;
            font-weight: 500;
        }

        .key-card-progress {
            margin-bottom: var(--spacing-md);
        }

        .key-card-progress-label {
            display: flex;
            justify-content: space-between;
            margin-bottom: var(--spacing-xs);
            font-size: 13px;
            font-weight: 600;
            color: var(--color-text-secondary);
        }

        .key-card-progress-bar {
            height: 10px;
            background: var(--color-bg);
            border-radius: 100px;
            overflow: hidden;
            position: relative;
        }

        .key-card-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--color-primary), var(--color-secondary));
            border-radius: 100px;
            transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }

        .key-card-progress-fill.warning {
            background: linear-gradient(90deg, var(--color-warning), #FF6B00);
        }

        .key-card-progress-fill.danger {
            background: linear-gradient(90deg, var(--color-danger), #D32F2F);
        }

        .key-card-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: var(--spacing-md);
            margin-bottom: var(--spacing-md);
            padding-top: var(--spacing-md);
            border-top: 1px solid var(--color-border);
        }

        .key-card-stat {
            text-align: center;
        }

        .key-card-stat-label {
            font-size: 11px;
            color: var(--color-text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .key-card-stat-value {
            font-size: 18px;
            font-weight: 700;
            color: var(--color-text-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
        }

        .key-card-dates {
            display: flex;
            justify-content: space-between;
            margin-bottom: var(--spacing-md);
            padding: var(--spacing-sm);
            background: var(--color-bg);
            border-radius: var(--radius-sm);
            font-size: 12px;
            color: var(--color-text-secondary);
        }

        .key-card-date {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .key-card-date-label {
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .key-card-date-value {
            font-family: 'Fira Code', monospace;
            font-size: 12px;
        }

        .key-card-actions {
            display: flex;
            gap: var(--spacing-sm);
            padding-top: var(--spacing-md);
            border-top: 1px solid var(--color-border);
        }

        .key-card-btn {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: var(--radius-sm);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--spacing-xs);
        }

        .key-card-btn-copy {
            background: var(--color-primary);
            color: white;
        }

        .key-card-btn-copy:hover {
            background: #0056D2;
            transform: translateY(-2px);
        }

        .key-card-btn-copy.copied {
            background: var(--color-success);
        }

        .key-card-btn-delete {
            background: var(--color-danger);
            color: white;
        }

        .key-card-btn-delete:hover {
            background: #D32F2F;
            transform: translateY(-2px);
        }

        .key-card-env-group {
            padding-top: var(--spacing-sm);
            border-top: 1px solid var(--color-border);
            margin-top: var(--spacing-sm);
        }

        .key-card-env-title {
            font-size: 11px;
            color: var(--color-text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: var(--spacing-xs);
            text-align: center;
        }

        .key-card-env-buttons {
            display: flex;
            gap: var(--spacing-xs);
        }

        .key-card-btn-env {
            flex: 1;
            padding: 10px;
            border: 1.5px solid var(--color-border);
            background: var(--color-surface);
            color: var(--color-text-primary);
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .key-card-btn-env:hover {
            background: var(--color-primary);
            color: white;
            border-color: var(--color-primary);
            transform: translateY(-2px);
        }

        .key-card-btn-env.copied {
            background: var(--color-success);
            color: white;
            border-color: var(--color-success);
        }

        /* 总计卡片样式 */
        .total-card {
            grid-column: 1 / -1;
            background: linear-gradient(135deg, rgba(0, 122, 255, 0.12) 0%, rgba(88, 86, 214, 0.12) 100%);
            border: 2px solid var(--color-primary);
            padding: var(--spacing-xl);
        }

        .total-card-title {
            font-size: 20px;
            font-weight: 700;
            color: var(--color-primary);
            margin-bottom: var(--spacing-lg);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .total-card-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: var(--spacing-lg);
        }

        .total-card-stat {
            text-align: center;
        }

        .total-card-stat-label {
            font-size: 13px;
            color: var(--color-text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: var(--spacing-xs);
        }

        .total-card-stat-value {
            font-size: 32px;
            font-weight: 700;
            color: var(--color-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
        }

        /* Responsive Design */
        @media (max-width: 1200px) {
            .cards-grid {
                grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            }
        }

        @media (max-width: 768px) {
            body { padding: var(--spacing-sm); }
            .header { padding: var(--spacing-md); }
            .header h1 { font-size: 24px; }
            .stats-cards {
                grid-template-columns: 1fr;
                padding: var(--spacing-lg);
            }
            .table-container {
                padding: 0 var(--spacing-md) var(--spacing-lg);
                overflow-x: scroll;
            }
            table {
                transform: scale(1);
                margin-bottom: var(--spacing-lg);
            }
            .manage-btn {
                position: static;
                margin-top: var(--spacing-md);
                width: 100%;
            }
            .refresh-btn {
                bottom: var(--spacing-md);
                right: var(--spacing-md);
                padding: 14px 24px;
            }
            .cards-grid {
                grid-template-columns: 1fr;
            }
            .key-card-stats {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Droid API 余额监控看板</h1>
            <div class="update-time" id="updateTime">正在加载...</div>
            <div style="margin-top: 4px; font-size: 13px; opacity: 0.85;">
                <span id="autoRefreshStatus">自动刷新: 启用中 | 下次刷新: <span id="headerNextRefresh">计算中...</span></span>
            </div>
            <div style="position: absolute; top: var(--spacing-md); right: var(--spacing-md); display: flex; gap: var(--spacing-sm);">
                <button class="theme-toggle-btn" id="themeToggle" onclick="toggleTheme()">🌙</button>
                <button class="manage-btn" onclick="toggleManagePanel()">⚙️ 管理密钥</button>
            </div>
        </div>

        <!-- Management Panel -->
        <div class="manage-panel" id="managePanel" style="display: none;">
            <div class="manage-content">
                <button class="close-btn" onclick="toggleManagePanel()">✕</button>
                <div class="manage-header">
                    <h2>批量导入密钥</h2>
                </div>
                <div class="manage-body">
                    <div class="import-section">
                        <h3>📦 添加 API Key</h3>
                        <p style="color: var(--color-text-secondary); font-size: 14px; margin-bottom: var(--spacing-md);">
                            每行粘贴一个 API Key，支持批量导入数百个密钥
                        </p>
                        <textarea id="importKeys" placeholder="每行粘贴一个 API Key&#10;fk-xxxxx&#10;fk-yyyyy&#10;fk-zzzzz" rows="10"></textarea>
                        <button class="import-btn" onclick="importKeys()">
                            <span id="importSpinner" style="display: none;" class="spinner"></span>
                            <span id="importText">🚀 导入密钥</span>
                        </button>
                        <div id="importResult" class="import-result"></div>
                    </div>

                    <div class="import-section" style="margin-top: var(--spacing-xl); padding-top: var(--spacing-xl); border-top: 1.5px solid var(--color-border);">
                        <h3>⏱️ 自动刷新设置</h3>
                        <p style="color: var(--color-text-secondary); font-size: 14px; margin-bottom: var(--spacing-md);">
                            设置自动刷新间隔时间（分钟）
                        </p>
                        <div style="display: flex; align-items: center; gap: var(--spacing-md); margin-bottom: var(--spacing-md);">
                            <input type="number" id="refreshInterval" min="1" max="1440" value="30"
                                   style="width: 120px; padding: 12px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); font-size: 15px; font-family: 'Fira Code', monospace;">
                            <span style="color: var(--color-text-secondary); font-size: 15px;">分钟</span>
                        </div>
                        <div style="display: flex; gap: var(--spacing-sm); margin-bottom: var(--spacing-md);">
                            <button class="import-btn" onclick="saveRefreshSettings()" style="background: var(--color-success);">
                                💾 保存设置
                            </button>
                            <button class="import-btn" onclick="toggleAutoRefresh()" id="toggleRefreshBtn" style="background: var(--color-secondary);">
                                ⏸️ 暂停自动刷新
                            </button>
                        </div>
                        <div id="refreshStatus" style="color: var(--color-text-secondary); font-size: 14px; font-weight: 500;">
                            下次刷新: <span id="nextRefreshDisplay">计算中...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="stats-cards" id="statsCards"></div>

        <div class="table-container">
            <div class="table-controls">
                <div class="view-toggle">
                    <button class="view-toggle-btn active" id="cardViewBtn" onclick="switchView('card')">
                        📇 卡片视图
                    </button>
                    <button class="view-toggle-btn" id="tableViewBtn" onclick="switchView('table')">
                        📊 表格视图
                    </button>
                </div>
                <div class="page-size-control">
                    <span>每页显示</span>
                    <select id="pageSizeSelect" class="page-size-select" onchange="changePageSize(this.value)">
                        <option value="10">10 条</option>
                        <option value="30">30 条</option>
                        <option value="100">100 条</option>
                        <option value="all">全部</option>
                    </select>
                </div>
            </div>
            <div id="tableContent">
                <div class="loading">正在加载数据...</div>
            </div>
        </div>
    </div>

    <button class="clear-zero-btn" onclick="clearZeroBalanceKeys()">
        <span class="spinner" style="display: none;" id="clearSpinner"></span>
        <span id="clearBtnText">🗑️ 清除零额度</span>
    </button>

    <button class="refresh-btn" onclick="loadData()">
        <span class="spinner" style="display: none;" id="spinner"></span>
        <span id="btnText">🔄 刷新数据</span>
    </button>

    <script>
        // 分页变量
        const PAGE_SIZE_STORAGE_KEY = 'tablePageSize';
        const VIEW_MODE_STORAGE_KEY = 'viewMode';
        let currentPage = 1;
        let itemsPerPage = getStoredPageSize() || 10; // 默认 10 条 / 页
        let allData = null;
        let currentViewMode = localStorage.getItem(VIEW_MODE_STORAGE_KEY) || 'card'; // 默认卡片视图

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
            toast.innerHTML = \`
                <span class="toast-icon">\${isError ? '❌' : '✅'}</span>
                <span class="toast-message">\${message}</span>
            \`;
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

        // 复制单个 Key - 优化版本(使用缓存)
        async function copyKey(id, button) {
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
                    button.innerHTML = '<span style="font-size: 18px;">✓</span>';
                    button.title = '已复制';
                    showToast('API Key 已复制到剪贴板');
                    
                    setTimeout(() => {
                        button.classList.remove('copied');
                        button.innerHTML = '<img src="https://images.icon-icons.com/4026/PNG/512/copy_icon_256034.png" class="btn-icon" alt="copy">';
                        button.title = '复制 API Key';
                    }, 2000);
                } else {
                    showToast('复制失败，请重试', true);
                }
            } catch (error) {
                showToast('复制失败: ' + error.message, true);
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
                        showToast(\`✅ 已复制 \${keys.length} 个 API Key\`);
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
                    
                    showToast(\`✅ 成功删除 \${result.success} 个 Key\${result.failed > 0 ? \`, \${result.failed} 个失败\` : ''}\`);
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
            
            renderTable();
        }

        // 取消所有选择
        function clearSelection() {
            selectedKeys.clear();
            renderTable();
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
                            <button class="batch-btn" onclick="batchCopyKeys()">📋 批量复制</button>
                            <button class="batch-btn danger" onclick="batchDeleteKeys()">🗑️ 批量删除</button>
                            <button class="batch-btn" onclick="clearSelection()">✕ 取消选择</button>
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

        function loadData() {
            const spinner = document.getElementById('spinner');
            const btnText = document.getElementById('btnText');

            spinner.style.display = 'inline-block';
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
                    document.getElementById('tableContent').innerHTML = \`<div class="error">❌ 加载失败: \${error.message}</div>\`;
                    document.getElementById('updateTime').textContent = "加载失败";
                })
                .finally(() => {
                    spinner.style.display = 'none';
                    btnText.textContent = '🔄 刷新数据';
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
            allData = data; // 保存数据
            document.getElementById('updateTime').textContent = \`最后更新: \${data.update_time} | 共 \${data.total_count} 个API Key\`;

            const totalAllowance = data.totals.total_totalAllowance;
            const totalUsed = data.totals.total_orgTotalTokensUsed;
            const totalRemaining = data.totals.total_tokensRemaining;
            const overallRatio = totalAllowance > 0 ? (totalAllowance - totalRemaining) / totalAllowance : 0;

            const statsCards = document.getElementById('statsCards');
            const progressWidth = Math.min(overallRatio * 100, 100); // 限制最大100%
            statsCards.innerHTML = \`
                <div class="stat-card"><div class="label">总计额度 (Total Allowance)</div><div class="value">\${formatNumber(totalAllowance)}</div></div>
                <div class="stat-card"><div class="label">已使用 (Total Used)</div><div class="value">\${formatNumber(totalUsed)}</div></div>
                <div class="stat-card"><div class="label">剩余额度 (Remaining)</div><div class="value">\${formatNumber(totalRemaining)}</div></div>
                <div class="stat-card">
                    <div class="progress-background" style="width: \${progressWidth}%"></div>
                    <div class="label">使用百分比 (Usage %)</div>
                    <div class="value">\${formatPercentage(overallRatio)}</div>
                </div>
            \`;

            // 根据当前视图模式渲染
            if (currentViewMode === 'card') {
                renderCards();
            } else {
                renderTable();
            }
        }

        // 视图切换函数
        function switchView(mode) {
            currentViewMode = mode;
            localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);

            // 更新按钮状态
            document.getElementById('cardViewBtn').classList.toggle('active', mode === 'card');
            document.getElementById('tableViewBtn').classList.toggle('active', mode === 'table');

            // 显示/隐藏统计卡片区域
            const statsCards = document.getElementById('statsCards');
            if (statsCards) {
                statsCards.style.display = mode === 'card' ? 'none' : 'grid';
            }

            // 重新渲染
            if (allData) {
                if (mode === 'card') {
                    renderCards();
                } else {
                    renderTable();
                }
            }
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

            const totalAllowance = data.totals.total_totalAllowance;
            const totalUsed = data.totals.total_orgTotalTokensUsed;
            const totalRemaining = data.totals.total_tokensRemaining;
            const overallRatio = totalAllowance > 0 ? (totalAllowance - totalRemaining) / totalAllowance : 0;

            let cardsHTML = '<div class="cards-grid">';

            // 总计卡片
            cardsHTML += \`
                <div class="key-card total-card">
                    <div class="total-card-title">📊 总计统计 (Total Summary)</div>
                    <div class="total-card-stats">
                        <div class="total-card-stat">
                            <div class="total-card-stat-label">总计额度</div>
                            <div class="total-card-stat-value">\${formatNumber(totalAllowance)}</div>
                        </div>
                        <div class="total-card-stat">
                            <div class="total-card-stat-label">已使用</div>
                            <div class="total-card-stat-value">\${formatNumber(totalUsed)}</div>
                        </div>
                        <div class="total-card-stat">
                            <div class="total-card-stat-label">剩余额度</div>
                            <div class="total-card-stat-value">\${formatNumber(totalRemaining)}</div>
                        </div>
                        <div class="total-card-stat">
                            <div class="total-card-stat-label">使用百分比</div>
                            <div class="total-card-stat-value">\${formatPercentage(overallRatio)}</div>
                        </div>
                    </div>
                </div>
            \`;

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
                            <div style="color: var(--color-danger); padding: 12px; text-align: center;">
                                ❌ 加载失败: \${item.error}
                            </div>
                            <div class="key-card-actions">
                                <button class="key-card-btn key-card-btn-delete" onclick="deleteKeyFromCard('\${item.id}')">
                                    🗑️ 删除
                                </button>
                            </div>
                        </div>
                    \`;
                } else {
                    const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                    const status = getStatusInfo(item.usedRatio, remaining);
                    const progressClass = status.class === 'status-danger' ? 'danger' : 
                                        (status.class === 'status-warning' ? 'warning' : '');

                    cardsHTML += \`
                        <div class="key-card \${isChecked ? 'selected' : ''}">
                            <div class="key-card-header">
                                <input type="checkbox" class="key-card-checkbox" \${isChecked ? 'checked' : ''} 
                                       onchange="toggleSelection('\${item.id}'); renderCards();">
                                <div class="key-card-id">\${item.id}</div>
                                <span class="key-card-status \${status.class}">\${status.text}</span>
                            </div>

                            <div class="key-card-key" title="\${item.key}">\${item.key}</div>

                            <div class="key-card-progress">
                                <div class="key-card-progress-label">
                                    <span>使用进度</span>
                                    <span>\${formatPercentage(item.usedRatio)}</span>
                                </div>
                                <div class="key-card-progress-bar">
                                    <div class="key-card-progress-fill \${progressClass}" 
                                         style="width: \${(item.usedRatio * 100).toFixed(2)}%"></div>
                                </div>
                            </div>

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
                                    <div class="key-card-stat-value">\${formatNumber(remaining)}</div>
                                </div>
                            </div>

                            <div class="key-card-dates">
                                <div class="key-card-date">
                                    <div class="key-card-date-label">开始时间</div>
                                    <div class="key-card-date-value">\${item.startDate}</div>
                                </div>
                                <div class="key-card-date">
                                    <div class="key-card-date-label">结束时间</div>
                                    <div class="key-card-date-value">\${item.endDate}</div>
                                </div>
                            </div>

                            <div class="key-card-actions">
                                <button class="key-card-btn key-card-btn-copy" 
                                        onclick="copyKeyFromCard('\${item.id}', this)">
                                    📋 复制 Key
                                </button>
                                <button class="key-card-btn key-card-btn-delete" 
                                        onclick="deleteKeyFromCard('\${item.id}')">
                                    🗑️ 删除
                                </button>
                            </div>

                            <div class="key-card-env-group">
                                <div class="key-card-env-title">复制环境变量</div>
                                <div class="key-card-env-buttons">
                                    <button class="key-card-btn-env" 
                                            onclick="copyEnvVar('\${item.id}', 'windows', this)">
                                        🪟 Windows
                                    </button>
                                    <button class="key-card-btn-env" 
                                            onclick="copyEnvVar('\${item.id}', 'unix', this)">
                                        🐧 非 Windows
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
                cardsHTML += \`<button class="pagination-btn" onclick="changePage(\${currentPage - 1})" \${currentPage === 1 ? 'disabled' : ''}>❮ 上一页</button>\`;
                cardsHTML += \`<span class="pagination-info">第 \${currentPage} / \${totalPages} 页 (共 \${data.data.length} 条)</span>\`;
                cardsHTML += \`<button class="pagination-btn" onclick="changePage(\${currentPage + 1})" \${currentPage === totalPages ? 'disabled' : ''}>下一页 ❯</button>\`;
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
                    button.innerHTML = '✅ 已复制';
                    showToast(\`环境变量命令已复制到剪贴板 (\${platform === 'windows' ? 'Windows' : '非 Windows'})\`);
                    
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
                    button.innerHTML = '✅ 已复制';
                    showToast('API Key 已复制到剪贴板');
                    
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
                    showToast('✅ 删除成功');
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

        function renderTable() {
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

            const totalAllowance = data.totals.total_totalAllowance;
            const totalUsed = data.totals.total_orgTotalTokensUsed;
            const totalRemaining = data.totals.total_tokensRemaining;
            const overallRatio = totalAllowance > 0 ? (totalAllowance - totalRemaining) / totalAllowance : 0;

            const allIds = data.data.map(item => item.id);
            const allSelected = allIds.length > 0 && allIds.every(id => selectedKeys.has(id));

            let tableHTML = \`
                <table>
                    <thead>
                        <tr>
                            <th class="checkbox-cell"><input type="checkbox" \${allSelected ? 'checked' : ''} onchange="toggleSelectAll()" title="全选/取消全选"></th>
                            <th>ID</th>
                            <th>API Key</th>
                            <th>开始时间</th>
                            <th>结束时间</th>
                            <th class="number">总计额度</th>
                            <th class="number">已使用</th>
                            <th class="number">剩余额度</th>
                            <th class="number">使用百分比</th>
                            <th style="text-align: center;">操作</th>
                        </tr>
                    </thead>
                    <tbody>\`;

            // 总计行放在第一行
            tableHTML += \`
                <tr class="total-row">
                    <td class="checkbox-cell"></td>
                    <td colspan="4">总计 (SUM)</td>
                    <td class="number">\${formatNumber(totalAllowance)}</td>
                    <td class="number">\${formatNumber(totalUsed)}</td>
                    <td class="number">\${formatNumber(totalRemaining)}</td>
                    <td class="number">\${formatPercentage(overallRatio)}</td>
                    <td></td>
                </tr>\`;

            // 数据行 - 只显示当前页
            pageData.forEach(item => {
                const isChecked = selectedKeys.has(item.id);
                if (item.error) {
                    tableHTML += \`
                        <tr>
                            <td class="checkbox-cell"><input type="checkbox" \${isChecked ? 'checked' : ''} onchange="toggleSelection('\${item.id}'); renderTable();"></td>
                            <td class="id-cell">\${item.id}</td>
                            <td class="key-cell" title="\${item.key}">\${item.key}</td>
                            <td colspan="6" class="error-row">加载失败: \${item.error}</td>
                            <td style="text-align: center;"><button class="table-delete-btn" onclick="deleteKeyFromTable('\${item.id}')">删除</button></td>
                        </tr>\`;
                } else {
                    const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                    tableHTML += \`
                        <tr>
                            <td class="checkbox-cell"><input type="checkbox" \${isChecked ? 'checked' : ''} onchange="toggleSelection('\${item.id}'); renderTable();"></td>
                            <td class="id-cell">\${item.id}</td>
                            <td class="key-cell" title="\${item.key}">\${item.key}</td>
                            <td class="date-cell">\${item.startDate}</td>
                            <td class="date-cell">\${item.endDate}</td>
                            <td class="number">\${formatNumber(item.totalAllowance)}</td>
                            <td class="number">\${formatNumber(item.orgTotalTokensUsed)}</td>
                            <td class="number">\${formatNumber(remaining)}</td>
                            <td class="number">\${formatPercentage(item.usedRatio)}</td>
                            <td style="text-align: center;">
                                <div class="action-buttons">
                                    <button class="table-copy-btn" onclick="copyKey('\${item.id}', this)" title="复制 API Key">
                                        <img src="https://images.icon-icons.com/4026/PNG/512/copy_icon_256034.png" class="btn-icon" alt="copy">
                                    </button>
                                    <button class="table-delete-btn" onclick="deleteKeyFromTable('\${item.id}')" title="删除">
                                        <img src="https://images.icon-icons.com/4026/PNG/96/remove_delete_trash_icon_255976.png" class="btn-icon" alt="delete">
                                    </button>
                                </div>
                            </td>
                        </tr>\`;
                }
            });

            tableHTML += \`
                    </tbody>
                </table>\`;

            // 添加分页控件
            if (totalPages > 1 && !isUnlimited) {
                tableHTML += \`<div class="pagination">\`;

                // 上一页按钮
                tableHTML += \`<button class="pagination-btn" onclick="changePage(\${currentPage - 1})" \${currentPage === 1 ? 'disabled' : ''}>❮ 上一页</button>\`;

                // 页码信息
                tableHTML += \`<span class="pagination-info">第 \${currentPage} / \${totalPages} 页 (共 \${data.data.length} 条)</span>\`;

                // 下一页按钮
                tableHTML += \`<button class="pagination-btn" onclick="changePage(\${currentPage + 1})" \${currentPage === totalPages ? 'disabled' : ''}>下一页 ❯</button>\`;

                tableHTML += \`</div>\`;
            }

            document.getElementById('tableContent').innerHTML = tableHTML;
            const pageSizeSelect = document.getElementById('pageSizeSelect');
            if (pageSizeSelect) {
                const selectValue = isUnlimited ? 'all' : String(itemsPerPage);
                if (pageSizeSelect.value !== selectValue) {
                    pageSizeSelect.value = selectValue;
                }
            }
            updateBatchToolbar();
        }

        function changePage(page) {
            if (!allData) return;

            if (itemsPerPage === Infinity) {
                currentPage = 1;
                renderTable();
                return;
            }

            const totalPages = Math.max(1, Math.ceil(allData.data.length / itemsPerPage));
            if (page < 1 || page > totalPages) return;

            currentPage = page;
            
            // 根据当前视图模式渲染
            if (currentViewMode === 'card') {
                renderCards();
            } else {
                renderTable();
            }

            // 滚动到表格顶部
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
            
            // 根据当前视图模式渲染
            if (currentViewMode === 'card') {
                renderCards();
            } else {
                renderTable();
            }

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
                    let message = \`✅ 成功添加 \${data.success} 个\`;
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
                text.textContent = '🚀 导入密钥';
            }
        }

        // Delete key from table - 从表格中删除密钥
        async function deleteKeyFromTable(id) {
            if (!confirm('确定要删除这个密钥吗？删除后需要刷新页面查看更新。')) {
                return;
            }

            try {
                const response = await fetch(\`/api/keys/\${id}\`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    // 删除成功后重新加载数据
                    loadData();
                } else {
                    const data = await response.json();
                    alert('删除失败: ' + data.error);
                }
            } catch (error) {
                alert('删除失败: ' + error.message);
            }
        }

        // Clear zero balance keys - 清除零额度或负额度的密钥
        async function clearZeroBalanceKeys() {
            if (!allData) {
                alert('请先加载数据');
                return;
            }

            // 找出剩余额度小于等于0的密钥
            const zeroBalanceKeys = allData.data.filter(item => {
                if (item.error) return false;
                const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                return remaining <= 0;
            });

            if (zeroBalanceKeys.length === 0) {
                alert('没有需要清除的零额度密钥');
                return;
            }

            if (!confirm(\`确定要删除 \${zeroBalanceKeys.length} 个零额度或负额度的密钥吗？此操作不可恢复！\`)) {
                return;
            }

            const clearSpinner = document.getElementById('clearSpinner');
            const clearBtnText = document.getElementById('clearBtnText');

            clearSpinner.style.display = 'inline-block';
            clearBtnText.textContent = '清除中...';

            let successCount = 0;
            let failCount = 0;

            // 批量删除
            for (const item of zeroBalanceKeys) {
                try {
                    const response = await fetch(\`/api/keys/\${item.id}\`, {
                        method: 'DELETE'
                    });

                    if (response.ok) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (error) {
                    failCount++;
                    console.error(\`Failed to delete key \${item.id}:\`, error);
                }
            }

            clearSpinner.style.display = 'none';
            clearBtnText.textContent = '🗑️ 清除零额度';

            alert(\`清除完成！\\n成功删除: \${successCount} 个\\n失败: \${failCount} 个\`);

            // 重新加载数据
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
                document.getElementById('autoRefreshStatus').innerHTML = '自动刷新: <span style="color: #FF9500;">已暂停</span>';
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
            document.getElementById('autoRefreshStatus').innerHTML = '自动刷新: <span style="color: #34C759;">启用中</span> | 下次刷新: <span id="headerNextRefresh">计算中...</span>';
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
            document.getElementById('autoRefreshStatus').innerHTML = '自动刷新: <span style="color: #FF9500;">已暂停</span>';
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
                btn.innerHTML = '⏸️ 暂停自动刷新';
                btn.style.background = 'var(--color-warning)';
            } else {
                btn.innerHTML = '▶️ 启动自动刷新';
                btn.style.background = 'var(--color-success)';
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

        // Theme toggle functions
        const THEME_STORAGE_KEY = 'themeMode';

        function initTheme() {
            const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

            // Use saved theme, or system preference, or default to light
            const theme = savedTheme || (prefersDark ? 'dark' : 'light');
            applyTheme(theme);
        }

        function applyTheme(theme) {
            const root = document.documentElement;
            const toggleBtn = document.getElementById('themeToggle');

            if (theme === 'dark') {
                root.setAttribute('data-theme', 'dark');
                if (toggleBtn) toggleBtn.textContent = '☀️';
            } else {
                root.removeAttribute('data-theme');
                if (toggleBtn) toggleBtn.textContent = '🌙';
            }
        }

        function toggleTheme() {
            const root = document.documentElement;
            const currentTheme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

            localStorage.setItem(THEME_STORAGE_KEY, newTheme);
            applyTheme(newTheme);

            // Add visual feedback
            showToast(`已切换到${newTheme === 'dark' ? '暗黑' : '浅色'}模式`);
        }

        document.addEventListener('DOMContentLoaded', () => {
            const pageSizeSelect = document.getElementById('pageSizeSelect');
            if (pageSizeSelect) {
                const selectValue = itemsPerPage === Infinity ? 'all' : String(itemsPerPage);
                if (pageSizeSelect.value !== selectValue) {
                    pageSizeSelect.value = selectValue;
                }
            }

            // Initialize theme first
            initTheme();

            // 初始化视图按钮状态
            document.getElementById('cardViewBtn').classList.toggle('active', currentViewMode === 'card');
            document.getElementById('tableViewBtn').classList.toggle('active', currentViewMode === 'table');

            // 初始化统计卡片显示状态
            const statsCards = document.getElementById('statsCards');
            if (statsCards) {
                statsCards.style.display = currentViewMode === 'card' ? 'none' : 'grid';
            }

            loadData();
            initAutoRefresh();
        });
    </script>
</body>
</html>
`;

// Continue with API functions...
async function fetchApiKeyData(id: string, key: string) {
  try {
    const response = await fetch('https://app.factory.ai/api/organization/members/chat-usage', {
      headers: {
        'Authorization': `Bearer ${key}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Error fetching data for key ID ${id}: ${response.status} ${errorBody}`);
      return { id, key: `${key.substring(0, 4)}...`, error: `HTTP ${response.status}` };
    }

    const apiData = await response.json();
    if (!apiData.usage || !apiData.usage.standard) {
        return { id, key: `${key.substring(0, 4)}...`, error: 'Invalid API response structure' };
    }

    const usageInfo = apiData.usage;
    const standardUsage = usageInfo.standard;

    const formatDate = (timestamp: number) => {
        if (!timestamp && timestamp !== 0) return 'N/A';
        try {
            return new Date(timestamp).toISOString().split('T')[0];
        } catch (e) {
            return 'Invalid Date';
        }
    }

    const maskedKey = `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
    return {
      id,
      key: maskedKey,
      startDate: formatDate(usageInfo.startDate),
      endDate: formatDate(usageInfo.endDate),
      orgTotalTokensUsed: standardUsage.orgTotalTokensUsed,
      totalAllowance: standardUsage.totalAllowance,
      usedRatio: standardUsage.usedRatio,
    };
  } catch (error) {
    console.error(`Failed to process key ID ${id}:`, error);
    return { id, key: `${key.substring(0, 4)}...`, error: 'Failed to fetch' };
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
    // 计算总 token 数量的时候，负数不计入内
    acc.total_tokensRemaining += Math.max(res.totalAllowance - res.orgTotalTokensUsed, 0);
    return acc;
  }, {
    total_orgTotalTokensUsed: 0,
    total_totalAllowance: 0,
    total_tokensRemaining: 0,
  });

  const beijingTime = new Date(Date.now() + 8 * 60 * 60 * 1000);

  const keysWithBalance = validResults.filter(r => {
    const remaining = (r.totalAllowance || 0) - (r.orgTotalTokensUsed || 0);
    return remaining > 0;
  });

  if (keysWithBalance.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("📋 剩余额度大于0的API Keys:");
    console.log("-".repeat(80));
    keysWithBalance.forEach(item => {
      const originalEntry = keyEntries.find(e => e.id === item.id);
      if (originalEntry) {
        console.log(originalEntry.key);
      }
    });
    console.log("=".repeat(80) + "\n");
  } else {
    console.log("\n⚠️  没有剩余额度大于0的API Keys\n");
  }

  return {
    update_time: format(beijingTime, "yyyy-MM-dd HH:mm:ss"),
    total_count: keyEntries.length,
    totals,
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
      return new Response(JSON.stringify({ error: error.message }), {
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
      return new Response(JSON.stringify({ error: error.message }), {
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
      return new Response(JSON.stringify({ error: error.message }), {
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
      return new Response(JSON.stringify({ error: error.message }), {
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
      return new Response(JSON.stringify({ error: error.message }), {
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
      return new Response(JSON.stringify({ error: error.message }), {
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
      return new Response(JSON.stringify({ error: error.message }), {
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
      return new Response(JSON.stringify({ error: error.message }), {
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
