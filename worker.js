const GROUPS = ["proxy", "direct", "reject"];
const MERGE_KEY = "merge";
const ALL_GROUPS = [...GROUPS, MERGE_KEY];
const CUSTOM_TYPES = ["rules", "merge"];

const RULE_TYPES = [
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-WILDCARD",
  "DOMAIN",
  "IP-CIDR",
  "IP-CIDR6",
  "IP-ASN",
  "GEOIP",
];

const RULE_TYPE_SET = new Set(RULE_TYPES);

const DEFAULT_RULES = {
  proxy: { name: "自定义代理规则", rules: [] },
  direct: { name: "自定义直连规则", rules: [] },
  reject: { name: "自定义拦截规则", rules: [] },
  merge: {
    name: "合并订阅规则",
    sources: [
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Advertising/Advertising.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Microsoft/Microsoft.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/OpenAI/OpenAI.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Claude/Claude.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Gemini/Gemini.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/GitHub/GitHub.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Google/Google.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Apple/Apple.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Telegram/Telegram.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Twitter/Twitter.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Facebook/Facebook.list",
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/YouTube/YouTube.list",
    ],
    rules: [],
  },
};

function sanitizeSuffix(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}

function normalizeRules(data) {
  const result = structuredClone(DEFAULT_RULES);

  if (!data || typeof data !== "object") return result;

  for (const group of ALL_GROUPS) {
    const source = data[group];
    if (!source || typeof source !== "object") continue;

    if (typeof source.name === "string" && source.name.trim()) {
      result[group].name = source.name.trim();
    }

    if (Array.isArray(source.rules)) {
      result[group].rules = source.rules
        .filter(
          (item) =>
            item &&
            typeof item === "object" &&
            RULE_TYPE_SET.has(item.type) &&
            typeof item.value === "string" &&
            item.value.trim()
        )
        .map((item) => ({
          type: item.type,
          value: item.value.trim(),
        }));
    }

    if (group === MERGE_KEY && Array.isArray(source.sources)) {
      result[group].sources = source.sources
        .filter((s) => typeof s === "string" && s.trim())
        .map((s) => s.trim());
    }
  }

  result.custom = [];
  if (Array.isArray(data.custom)) {
    const usedSlugs = new Set(ALL_GROUPS);
    for (const item of data.custom) {
      if (!item || typeof item !== "object") continue;

      const type = item.type === MERGE_KEY ? MERGE_KEY : "rules";
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
      if (!name) continue;
      const key = typeof item.key === "string" && item.key.trim() ? item.key.trim() : null;
      if (!key) continue;
      const suffix = sanitizeSuffix(item.suffix);
      if (!suffix || usedSlugs.has(suffix)) continue;

      const custom = {
        key,
        type,
        name,
        desc: typeof item.desc === "string" ? item.desc.trim() : "",
        suffix,
        rules: [],
        sources: [],
      };

      if (Array.isArray(item.rules)) {
        custom.rules = item.rules
          .filter(
            (rule) =>
              rule &&
              typeof rule === "object" &&
              RULE_TYPE_SET.has(rule.type) &&
              typeof rule.value === "string" &&
              rule.value.trim()
          )
          .map((rule) => ({ type: rule.type, value: rule.value.trim() }));
      }

      if (type === MERGE_KEY && Array.isArray(item.sources)) {
        custom.sources = item.sources
          .filter((s) => typeof s === "string" && s.trim())
          .map((s) => s.trim());
      }

      result.custom.push(custom);
      usedSlugs.add(suffix);
    }
  }

  return result;
}

async function loadRules(storage) {
  const value = await storage.get("rules");
  if (!value) return structuredClone(DEFAULT_RULES);

  try {
    return normalizeRules(JSON.parse(value));
  } catch {
    return structuredClone(DEFAULT_RULES);
  }
}

async function saveRules(storage, data) {
  const rules = normalizeRules(data);
  await storage.put("rules", JSON.stringify(rules));
  return rules;
}

const BACKUP_PREFIX = "backup:";
const BACKUP_INDEX_KEY = "backup_index";
const BACKUP_LIMIT = 10;

async function listBackups(kv) {
  const raw = await kv.get(BACKUP_INDEX_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .filter((b) => b && typeof b.key === "string")
          .map((b) => ({ key: b.key, time: Number(b.time) || 0 }))
          .sort((a, b) => b.time - a.time);
      }
    } catch {}
  }

  const items = await kv.list({ prefix: BACKUP_PREFIX });
  const backups = items.keys.map((k) => {
    const ts = Number(k.name.slice(BACKUP_PREFIX.length));
    return { key: k.name, time: Number.isFinite(ts) ? ts : 0 };
  });
  backups.sort((a, b) => b.time - a.time);
  try {
    await kv.put(BACKUP_INDEX_KEY, JSON.stringify(backups.slice(0, BACKUP_LIMIT)));
  } catch {}
  return backups;
}

async function createBackup(kv) {
  const rules = await loadRules(kv);
  const time = Date.now();
  const key = BACKUP_PREFIX + time;
  await kv.put(key, JSON.stringify(rules));

  const merged = [{ key, time }, ...(await listBackups(kv))]
    .sort((a, b) => b.time - a.time);
  const keep = merged.slice(0, BACKUP_LIMIT);
  for (const old of merged.slice(BACKUP_LIMIT)) {
    await kv.delete(old.key);
  }
  await kv.put(BACKUP_INDEX_KEY, JSON.stringify(keep));
  return key;
}

async function restoreBackup(kv, key) {
  if (typeof key !== "string" || !key.startsWith(BACKUP_PREFIX)) {
    return { error: "invalid backup key" };
  }
  const raw = await kv.get(key);
  if (!raw) return { error: "backup not found" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "backup corrupted" };
  }
  return { rules: await saveRules(kv, data) };
}

function findGroupByKey(data, key) {
  if (ALL_GROUPS.includes(key)) return data[key] || DEFAULT_RULES[key];
  if (Array.isArray(data.custom)) {
    return data.custom.find((g) => g.key === key) || null;
  }
  return null;
}

function findGroupBySuffix(data, suffix) {
  if (ALL_GROUPS.includes(suffix)) return { key: suffix, type: suffix };
  if (Array.isArray(data.custom)) {
    const custom = data.custom.find((g) => g.suffix === suffix);
    if (custom) return { key: custom.key, type: custom.type };
  }
  return null;
}

function generateRuleSet(key, data) {
  const config = findGroupByKey(data, key);
  if (!config) return null;

  const lines = [
    `# NAME: ${config.name || DEFAULT_RULES[key]?.name || key}`,
    `# TOTAL: ${config.rules.length}`,
    "",
  ];

  for (const rule of config.rules) {
    let line = `${rule.type},${rule.value}`;

    if (
      rule.type === "IP-CIDR" ||
      rule.type === "IP-CIDR6" ||
      rule.type === "IP-ASN"
    ) {
      line += ",no-resolve";
    }

    lines.push(line);
  }

  return lines.join("\n") + "\n";
}

const IMPORT_POLICY_MAP = {
  PROXY: "proxy",
  DIRECT: "direct",
  REJECT: "reject",
};

function parseRuleImport(text) {
  const result = { proxy: [], direct: [], reject: [], errors: [] };

  if (typeof text !== "string") return result;

  const lines = text.split("\n");

  lines.forEach((line, idx) => {
    const raw = line.trim();
    if (!raw) return;
    if (raw.startsWith("#") || raw.startsWith("//") || raw.startsWith(";")) return;

    const parts = raw.split(",").map((s) => s.trim());
    const type = parts[0] || "";
    const value = parts[1] || "";
    const policy = (parts[2] || "").toUpperCase();

    if (!RULE_TYPE_SET.has(type)) {
      result.errors.push(`第${idx + 1}行: 未知规则类型「${type || "空"}」`);
      return;
    }

    if (!value) {
      result.errors.push(`第${idx + 1}行: 缺少规则值`);
      return;
    }

    const group = IMPORT_POLICY_MAP[policy];
    if (!group) {
      result.errors.push(
        `第${idx + 1}行: 无法识别的策略「${parts[2] || "空"}」（需 PROXY / DIRECT / REJECT）`
      );
      return;
    }

    result[group].push({ type, value });
  });

  return result;
}

function mergeRules(existing, incoming) {
  const seen = new Set(existing.map((r) => r.type + ":" + r.value));
  const merged = existing.slice();

  for (const rule of incoming) {
    const key = rule.type + ":" + rule.value;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(rule);
    }
  }

  return merged;
}

function parseRuleLine(line) {
  const raw = line.trim();
  if (!raw) return null;
  if (raw.startsWith("#") || raw.startsWith("//") || raw.startsWith(";")) return null;

  const parts = raw.split(",").map((s) => s.trim());
  const type = parts[0] || "";
  const value = parts[1] || "";

  if (!RULE_TYPE_SET.has(type) || !value) return null;

  return { type, value };
}

async function fetchAndMerge(sources) {
  const seen = new Set();
  const rules = [];
  let skipped = 0;

  for (const url of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        skipped++;
        continue;
      }
      const text = await res.text();
      for (const line of text.split("\n")) {
        const rule = parseRuleLine(line);
        if (!rule) {
          skipped++;
          continue;
        }
        const key = rule.type + ":" + rule.value;
        if (!seen.has(key)) {
          seen.add(key);
          rules.push(rule);
        }
      }
    } catch {
      skipped++;
    }
  }

  return { rules, skipped };
}

async function syncMergeRules(kv, key = MERGE_KEY) {
  const current = await loadRules(kv);
  const config = findGroupByKey(current, key);
  if (!config) return { error: `组「${key}」不存在` };
  if (config.type && config.type !== MERGE_KEY) {
    return { error: `组「${key}」不是合并组` };
  }
  const sources = config.sources || [];
  const result = await fetchAndMerge(sources);
  config.rules = result.rules;
  const saved = await saveRules(kv, current);
  return { ...result, data: saved };
}

async function syncAllMergeRules(kv) {
  const current = await loadRules(kv);
  const keys = [
    MERGE_KEY,
    ...(Array.isArray(current.custom) ? current.custom.filter((g) => g.type === MERGE_KEY).map((g) => g.key) : []),
  ];
  const results = [];
  for (const key of keys) {
    const config = findGroupByKey(current, key);
    if (!config) continue;
    const sources = config.sources || [];
    const result = await fetchAndMerge(sources);
    config.rules = result.rules;
    results.push({ key, total: result.rules.length, skipped: result.skipped });
  }
  const saved = await saveRules(kv, current);
  return { results, data: saved };
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === name) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return null;
}

async function getAdminPassword(kv, env) {
  const kvPassword = await kv.get("admin_password");
  if (kvPassword) return kvPassword;
  return env.ADMIN_PASSWORD || null;
}

const LOGIN_LOCK_KEY = "login_lock";
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

async function getLoginLock(kv) {
  const raw = await kv.get(LOGIN_LOCK_KEY);
  if (!raw) return { count: 0, until: 0 };
  try {
    const data = JSON.parse(raw);
    const until = Number(data.until) || 0;
    const count = Math.min(LOGIN_MAX_FAILS, Number(data.count) || 0);

    if (until > 0 && until < Date.now()) {
      kv.delete(LOGIN_LOCK_KEY).catch(() => {});
      return { count: 0, until: 0 };
    }

    return { count, until };
  } catch {
    kv.delete(LOGIN_LOCK_KEY).catch(() => {});
    return { count: 0, until: 0 };
  }
}

function loginLockRemaining(lock, now = Date.now()) {
  return Math.max(0, lock.until - now);
}

async function recordLoginFail(kv) {
  const lock = await getLoginLock(kv);
  if (loginLockRemaining(lock) > 0) return lock;

  const count = lock.count + 1;
  if (count >= LOGIN_MAX_FAILS) {
    const until = Date.now() + LOGIN_LOCK_MS;
    await kv.put(LOGIN_LOCK_KEY, JSON.stringify({ count: LOGIN_MAX_FAILS, until }));
    return { count: LOGIN_MAX_FAILS, until };
  }
  await kv.put(LOGIN_LOCK_KEY, JSON.stringify({ count, until: 0 }));
  return { count, until: 0 };
}

async function isAdmin(request, kv, env) {
  const password = await getAdminPassword(kv, env);

  if (!password) return false;

  const authorization = request.headers.get("Authorization") || "";
  if (authorization === `Bearer ${password}`) {
    return true;
  }

  const cookiePassword = getCookie(request, "sr_admin");
  return cookiePassword === password;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getLoginHTML() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='85'>🚀</text></svg>">
<title>Shadowrocket Rules</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f5f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:420px;margin:12vh auto;padding:24px}
.card{background:#fff;border:1px solid #e6eaf0;border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(20,30,50,.06)}
h1{margin:0 0 8px;font-size:24px}
p{color:#687386}
input{width:100%;padding:13px 14px;border:1px solid #ccd3df;border-radius:10px;font-size:16px}
button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:10px;background:#111827;color:#fff;font-size:16px;cursor:pointer}
.err{color:#c62828;margin-top:12px;min-height:20px}
</style>
</head>
<body>
<div class="wrap">
<div class="card">
<h1>Shadowrocket Rules</h1>
<p>管理员登录</p>
<form id="login">
<input id="password" type="password" placeholder="管理员密码" autocomplete="current-password" required>
<button>登录</button>
<div class="err" id="err"></div>
</form>
</div>
</div>
<script>
document.getElementById("login").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const password=document.getElementById("password").value;
  const res=await fetch("/api/login",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({password})
  });
  const data=await res.json().catch(()=>({}));
  const err=document.getElementById("err");
  if(res.ok){
    location.href="/admin";
  }else if(res.status===423 || (data&&data.locked)){
    err.textContent="尝试次数过多，已被锁定 15 分钟，请稍后再试";
  }else if(data&&data.failsLeft){
    err.textContent="密码错误，剩余可尝试次数："+data.failsLeft;
  }else{
    err.textContent="密码错误";
  }
});
</script>
</body>
</html>`;
}

function getAdminHTML() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='85'>🚀</text></svg>">
<title>Shadowrocket Rules 管理</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f5f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1000px;margin:30px auto;padding:0 18px}
header{position:sticky;top:0;z-index:40;display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;padding:14px 0;background:#f5f7fb;border-bottom:1px solid #e6eaf0}
h1{margin:0;font-size:25px}
.actions{display:flex;gap:8px}
button{border:1px solid #d6dce6;background:#fff;border-radius:9px;padding:9px 13px;cursor:pointer}
.primary{background:#111827;color:#fff;border-color:#111827}
.danger{color:#b42318}
.card{background:#fff;border:1px solid #e6eaf0;border-radius:14px;padding:18px;margin-bottom:16px}
.row{display:flex;gap:8px;margin-top:10px}
.row input,.row select{flex:1;min-width:0;padding:10px;border:1px solid #ccd3df;border-radius:8px}
.rule{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eef1f5}
.rule:last-child{border-bottom:0}
.rtext{flex:1;min-width:0;font-family:ui-monospace,monospace;font-size:13px;word-break:break-all}
.rule button{flex-shrink:0}
.texthint{font-size:13px;color:#687386;margin:8px 0 4px}
textarea.txt{width:100%;font-family:ui-monospace,monospace;font-size:13px;border:1px solid #ccd3df;border-radius:8px;padding:10px;line-height:1.6}
.gstatus{min-height:20px;color:#087443}
.small{font-size:13px;color:#687386}
.urls{display:grid;gap:8px}
.url{background:#f6f8fb;border:1px solid #e2e7ef;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.url .urlrow{display:flex;align-items:center;gap:8px}
.url .urlpath{font-family:ui-monospace,monospace;font-size:13px;margin-left:auto}
.url button{flex-shrink:0;padding:4px 10px;font-size:12px}
.status{min-height:22px;color:#087443}
.modal{position:fixed;inset:0;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;z-index:50}
.modal .inner{background:#fff;border-radius:14px;padding:20px;width:min(680px,92vw);box-shadow:0 10px 40px rgba(0,0,0,.2)}
.layout{display:flex;gap:16px;align-items:flex-start}
.suffixpre{background:#eef1f7;border:1px solid #ccd3df;border-right:0;border-radius:9px 0 0 9px;padding:9px 10px;color:#556;white-space:nowrap}
.row input.flex{flex:1}
.tabs{width:130px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;position:sticky;top:80px}
.tabs button.tab{width:100%;padding:12px 14px;border-radius:9px;text-align:left;background:#fff}
.tabs button.tab.active{background:#111827;color:#fff;border-color:#111827}
.tabs button.tab.addtab{background:transparent;border:1px dashed #9aa5b8;color:#556;font-weight:500;cursor:pointer}
.tabs button.tab.addtab:hover{border-color:#111827;color:#111827}
.main{flex:1;min-width:0}
.side{width:300px;flex-shrink:0}
.side .card:first-child{margin-top:0}
@media(max-width:900px){.layout{flex-direction:column}.tabs{width:100%;flex-direction:row;position:static}.tabs button.tab{flex:1;text-align:center}.side{width:100%}}
@media(max-width:650px){header{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions button{flex:1}}
</style>
</head>
<body>
<div class="wrap">
<header>
<div>
<h1>Shadowrocket Rules</h1>
<div class="small">个人规则管理器</div>
</div>
<div class="actions">
<button class="primary" onclick="save()">保存全部</button>
<button onclick="openBackup()">备份/恢复</button>
<button onclick="toggleImport()">批量导入</button>
<button onclick="logout()">退出</button>
</div>
</header>

<div class="card" id="importCard" style="display:none">
<h3>批量导入规则</h3>
<div class="small">粘贴文本，每行一条，格式：<code>规则类型,值,策略</code><br>
策略写 <code>PROXY</code> / <code>DIRECT</code> / <code>REJECT</code>，自动分配到对应分组。支持多行，自动跳过空行和 <code>#</code> 注释行。</div>
<div class="row" style="margin-top:10px">
<textarea id="importText" rows="8" style="width:100%;font-family:ui-monospace,monospace;font-size:13px;border:1px solid #ccd3df;border-radius:8px;padding:10px" placeholder="DOMAIN-SUFFIX,yfamilys.com,PROXY&#10;DOMAIN-SUFFIX,eteams.cn,DIRECT&#10;DOMAIN-KEYWORD,ads.example.com,REJECT&#10;IP-CIDR,192.168.0.0/24,DIRECT"></textarea>
</div>
<div class="row">
<button class="primary" onclick="importRules()">解析并导入</button>
<button onclick="toggleImport()">关闭</button>
</div>
<div class="status" id="importStatus"></div>
</div>

<div class="layout">
<div class="tabs" id="tabs"></div>
<div id="app" class="main"></div>
<div class="side" id="side">
<div class="card">
<h3>Shadowrocket RULE-SET</h3>
<div class="small">以下地址无需管理员密码，点击即可复制。</div>
<div class="urls" id="urlList" style="margin-top:10px"></div>
</div>
</div>
</div>

<div class="status" id="status"></div>
</div>

<div class="modal" id="newGroupModal" style="display:none">
<div class="inner">
<h3 style="margin:0 0 6px">新建规则组</h3>
<div class="texthint">选择一个类型，其余信息可稍后在卡片内修改。</div>
<div class="row">
<select id="ng-type">
<option value="rules">自定义规则</option>
<option value="merge">合并订阅</option>
</select>
</div>
<div class="row"><input id="ng-name" placeholder="组名称（必填）"></div>
<div class="row"><input id="ng-desc" placeholder="说明（可选）"></div>
<div class="row">
<span class="suffixpre">/ss-</span>
<input id="ng-suffix" placeholder="url后缀，如 mylist（自动加 ss- 前缀）">
</div>
<div class="gstatus" id="ng-status" style="margin-top:8px"></div>
<div class="row" style="justify-content:flex-end">
<button class="primary" id="ng-ok">创建</button>
<button id="ng-cancel">取消</button>
</div>
</div>
</div>

<div class="modal" id="backupModal" style="display:none">
<div class="inner">
<h3 style="margin:0 0 6px">备份 / 恢复</h3>
<div class="texthint">备份保存在 KV，最多保留最近 10 份。恢复会<strong>覆盖当前所有规则</strong>，请谨慎操作。</div>
<div class="row" style="margin-top:10px">
<button class="primary" onclick="createBackup()">立即备份</button>
<button onclick="closeBackup()">关闭</button>
</div>
<div class="gstatus" id="backupStatus" style="margin-top:8px"></div>
<div class="urls" id="backupList" style="margin-top:10px"></div>
</div>
</div>

<div class="modal" id="editModal" style="display:none">
<div class="inner">
<h3 style="margin:0 0 6px">文本编辑 <span class="small" id="modalTitle"></span></h3>
<div class="texthint">每行一条：<code>类型,值</code>，可整体替换该组全部规则；支持空行和 <code>#</code> 注释。</div>
<textarea id="editText" class="txt" rows="14" placeholder="DOMAIN-SUFFIX,google.com&#10;IP-CIDR,1.2.3.0/24&#10;# 注释行"></textarea>
<div class="gstatus" id="editStatus" style="margin-top:8px"></div>
<div class="row" style="justify-content:flex-end">
<button class="primary" id="editApply">应用并保存</button>
<button id="editCancel">取消</button>
</div>
</div>
</div>

<script>
let data=null;

const DEFAULT_KEYS=["proxy","direct","reject","merge"];
const GROUPS=[
  {key:"proxy",title:"代理规则",icon:"🛡️"},
  {key:"direct",title:"直连规则",icon:"🌐"},
  {key:"reject",title:"拦截规则",icon:"🚫"},
  {key:"merge",title:"合并订阅",icon:"🔀"}
];

const types=[
  "DOMAIN-SUFFIX","DOMAIN-KEYWORD","DOMAIN-WILDCARD","DOMAIN",
  "IP-CIDR","IP-CIDR6","IP-ASN","GEOIP"
];

async function api(url,options){
  const res=await fetch(url,options);
  if(res.status===401){
    location.href="/";
    throw new Error("未登录");
  }
  if(!res.ok) throw new Error(await res.text());
  return res;
}

function customGroups(){
  return Array.isArray(data.custom)?data.custom:[];
}

let activeTab="proxy";

function renderTabs(){
  const tabs=document.getElementById("tabs");
  tabs.innerHTML="";
  for(const group of GROUPS){
    const btn=document.createElement("button");
    btn.className="tab"+(group.key===activeTab?" active":"");
    btn.textContent=(group.icon||"")+" "+group.title;
    btn.dataset.g=group.key;
    btn.addEventListener("click",()=>{activeTab=group.key;render();});
    tabs.appendChild(btn);
  }
  customGroups().forEach(g=>{
    const btn=document.createElement("button");
    btn.className="tab"+(g.key===activeTab?" active":"");
    const icon=g.type==="merge"?"📦":"📋";
    btn.textContent=icon+" "+(g.name||g.key);
    btn.dataset.g=g.key;
    btn.addEventListener("click",()=>{activeTab=g.key;render();});
    tabs.appendChild(btn);
  });
  const add=document.createElement("button");
  add.className="tab addtab";
  add.textContent="+ 新建规则组";
  add.addEventListener("click",openNewGroup);
  tabs.appendChild(add);
}

function groupConfig(key){
  if(DEFAULT_KEYS.indexOf(key)!==-1) return data[key];
  return customGroups().find(g=>g.key===key)||null;
}

function groupTitle(key){
  const g=GROUPS.find(x=>x.key===key);
  if(g) return g.title;
  const c=customGroups().find(x=>x.key===key);
  return c?c.name||key:key;
}

function hourNote(key){
  const cfg=groupConfig(key);
  if(cfg&&cfg.type==="merge") return "，每日 04:00 自动同步";
  return "";
}

function render(){
  renderTabs();

  const app=document.getElementById("app");
  app.innerHTML="";

  const cfg=groupConfig(activeTab);
  if(!cfg){
    app.innerHTML='<div class="card"><div class="small">该组不存在或已被删除</div></div>';
    renderUrls();
    return;
  }

  const isMerge=cfg.type==="merge"||activeTab==="merge";
  const isDefault=DEFAULT_KEYS.indexOf(activeTab)!==-1;
  const box=document.createElement("div");
  box.className="card";

  const titleLine=
    "<h2>"+escapeHtml(groupTitle(activeTab))+' <span class="small">('+((cfg.sources||[]).length)+' 个源 / '+(cfg.rules||[]).length+' 条规则'+hourNote(activeTab)+')</span></h2>';

  let headButtons='';
  if(isMerge){
    headButtons='<button class="primary" data-act="syncmerge" data-group="'+activeTab+'">立即同步</button>'+
      '<button data-act="copygroup" data-group="'+activeTab+'">复制合并文本</button>';
  }else{
    headButtons='<button data-act="copygroup" data-group="'+activeTab+'">复制文本</button>'+
      '<button data-act="editgroup" data-group="'+activeTab+'">文本编辑</button>';
  }

  let extraFields='';
  if(!isDefault){
    extraFields=
      '<div class="row"><input id="name-'+activeTab+'" value="'+escapeAttr(cfg.name)+'" placeholder="组名称"></div>'+
      '<div class="row"><input id="desc-'+activeTab+'" value="'+escapeAttr(cfg.desc||"")+'" placeholder="说明（可选）"></div>'+
      '<div class="row">'+
      '<span class="suffixpre">/ss-</span>'+
      '<input id="suffix-'+activeTab+'" value="'+escapeAttr(cfg.suffix||"")+'" placeholder="url后缀" class="flex">'+
      '</div>';
  }else if(!isMerge){
    extraFields='<div class="row"><input id="name-'+activeTab+'" value="'+escapeAttr(cfg.name)+'" placeholder="规则集名称"></div>';
  }

  let opRow='';
  if(!isDefault){
    opRow='<button class="danger" data-act="delgroup" data-group="'+activeTab+'">删除该组</button>';
  }

  box.innerHTML=
    titleLine+
    '<div class="row" style="margin-bottom:4px">'+headButtons+
    (isDefault?'':'')+
    '</div>'+
    extraFields+
    (isMerge?
      '<div class="texthint">添加远程订阅源：填入 URL 后点「添加」，来源规则会被拉取、去重合并到 <code>/ss-'+groupSlug(activeTab)+'.list</code>（不含策略列，策略由你在 Shadowrocket 里指定）。</div>'+
      '<div class="row">'+
      '<input id="merge-source-input" placeholder="https://raw.githubusercontent.com/xxx/xx.list">'+
      '<button class="primary" data-act="addsource" data-group="'+activeTab+'">添加订阅源</button>'+
      '</div>'+
      '<div id="merge-sources" style="margin-top:12px"></div>'+
      '<div class="gstatus" id="gstatus-'+activeTab+'" style="margin-top:8px"></div>'
    :
      '<div class="row">'+
      '<select id="type-'+activeTab+'">'+types.map(t=>"<option>"+t+"</option>").join("")+'</select>'+
      '<input id="value-'+activeTab+'" placeholder="例如 google.com / 192.168.1.0/24">'+
      '<button class="primary" data-act="addrule" data-group="'+activeTab+'">添加</button>'+
      '</div>'+
      '<div id="rules-'+activeTab+'" style="margin-top:12px"></div>'
    )+
    (opRow?'<div class="row" style="margin-top:12px">'+opRow+'</div>':'');

  app.appendChild(box);

  if(isMerge){
    const list=box.querySelector("#merge-sources");
    const sources=cfg.sources||[];
    if(sources.length===0){
      list.innerHTML='<div class="small">暂无订阅源，添加后点「立即同步」拉取合并</div>';
    }else{
      sources.forEach((url,index)=>{
        const item=document.createElement("div");
        item.className="rule";
        item.innerHTML=
          '<span class="rtext">'+escapeHtml(url)+'</span>'+
          '<button class="danger" data-act="delsource" data-group="'+activeTab+'" data-index="'+index+'">删除</button>';
        list.appendChild(item);
      });
    }
  }else{
    const list=box.querySelector("#rules-"+activeTab);
    const rules=cfg.rules||[];
    if(rules.length===0){
      list.innerHTML='<div class="small">暂无规则</div>';
    }else{
      rules.forEach((rule,index)=>{
        const item=document.createElement("div");
        item.className="rule";
        item.innerHTML=
          '<span class="rtext">'+escapeHtml(rule.type+","+rule.value)+'</span>'+
          '<button class="danger" data-act="delrule" data-group="'+activeTab+'" data-index="'+index+'">删除</button>';
        list.appendChild(item);
      });
    }
  }

  renderUrls();
}

function groupSlug(key){
  if(DEFAULT_KEYS.indexOf(key)!==-1) return key;
  const cfg=groupConfig(key);
  return cfg?cfg.suffix:"";
}

function renderUrls(){
  const list=document.getElementById("urlList");
  list.innerHTML="";
  const all=[];

  GROUPS.forEach(g=>all.push({title:g.title,suffix:g.key,key:g.key,icon:g.icon||""}));
  customGroups().forEach(g=>all.push({
    title:(g.name||g.key),
    suffix:g.suffix,
    key:g.key,
    icon:g.type==="merge"?"📦":"📋"
  }));

  all.forEach(item=>{
    const div=document.createElement("div");
    div.className="url";

    const name=document.createElement("div");
    name.className="small";
    name.textContent=item.icon+" "+item.title;

    const row=document.createElement("div");
    row.className="urlrow";
    const suffix=document.createElement("span");
    suffix.className="urlpath";
    suffix.textContent="ss-"+item.suffix+".list";
    const btn=document.createElement("button");
    btn.dataset.path="/ss-"+item.suffix+".list";
    btn.textContent="复制";
    btn.addEventListener("click",(e)=>{
      const path=e.currentTarget.dataset.path;
      navigator.clipboard.writeText(location.origin+path);
    });

    row.appendChild(suffix);
    row.appendChild(btn);
    div.appendChild(name);
    div.appendChild(row);
    list.appendChild(div);
  });
}

function groupPolicy(group){
  return {proxy:"PROXY",direct:"DIRECT",reject:"REJECT"}[group]||"PROXY";
}

function groupType(key){
  if(DEFAULT_KEYS.indexOf(key)!==-1) return key;
  const cfg=groupConfig(key);
  return cfg?cfg.type:"proxy";
}

function groupPolicyFor(key){
  if(key==="proxy") return "PROXY";
  if(key==="direct") return "DIRECT";
  if(key==="reject") return "REJECT";
  return null;
}

function parseGroupText(text,policy){
  const rules=[];
  const errors=[];
  const lines=text.split("\\n");
  lines.forEach((ln,i)=>{
    const line=ln.trim();
    if(!line||line.startsWith("#")||line.startsWith("//")||line.startsWith(";")) return;
    const parts=line.split(",").map(s=>s.trim());
    const type=parts[0]||"";
    const value=parts[1]||"";
    const pol=(parts[2]||"").toUpperCase();
    if(types.indexOf(type)===-1){ errors.push("第"+(i+1)+"行: 未知类型「"+type+"」"); return; }
    if(!value){ errors.push("第"+(i+1)+"行: 缺少规则值"); return; }
    if(policy && pol && pol!==policy){ errors.push("第"+(i+1)+"行: 策略「"+pol+"」与本组("+policy+")不符"); return; }
    rules.push({type,value});
  });
  const seen=new Set();
  const uniq=[];
  for(const r of rules){
    const k=r.type+"|"+r.value;
    if(!seen.has(k)){ seen.add(k); uniq.push(r); }
  }
  return {rules:uniq,errors};
}

let editGroupKey=null;

function openEdit(group){
  editGroupKey=group;
  const policy=groupPolicyFor(group);
  const cfg=groupConfig(group);
  document.getElementById("modalTitle").textContent=groupTitle(group)+(policy?"（"+policy+"）":"");
  const text=cfg.rules.map(r=>r.type+","+r.value).join("\\n");
  document.getElementById("editText").value=text;
  document.getElementById("editStatus").textContent="";
  document.getElementById("editModal").style.display="flex";
  document.getElementById("editText").focus();
}

function closeEdit(){
  document.getElementById("editModal").style.display="none";
  editGroupKey=null;
}

async function applyGroup(){
  if(!editGroupKey) return;
  const group=editGroupKey;
  const ta=document.getElementById("editText");
  const status=document.getElementById("editStatus");
  const cfg=groupConfig(group);
  if(!cfg) return;
  const parsed=parseGroupText(ta.value||"",groupPolicyFor(group));

  if(parsed.errors.length){
    status.textContent="有 "+parsed.errors.length+" 行未通过："+parsed.errors.join("；")+" —— 未应用";
    return;
  }

  cfg.rules=parsed.rules;
  await save();
  closeEdit();
}

function copyGroup(group,btn){
  const cfg=groupConfig(group);
  if(!cfg) return;
  const policy=groupPolicyFor(group);
  const text=cfg.rules.map(r=>r.type+","+r.value+(policy?","+policy:"")).join("\\n")||"（该组暂无规则）";
  navigator.clipboard.writeText(text).then(()=>{
    const old=btn.textContent;
    btn.textContent="已复制";
    setTimeout(()=>btn.textContent=old,1200);
  });
}

function addSource(){
  const cfg=groupConfig(activeTab);
  if(!cfg||groupType(activeTab)!=="merge") return;
  const input=document.getElementById("merge-source-input");
  const url=input.value.trim();
  const gstatus=document.getElementById("gstatus-"+activeTab);
  if(!url){
    gstatus.textContent="请填写订阅源 URL";
    return;
  }
  if(!/^https?:\\/\\//i.test(url)){
    gstatus.textContent="URL 需以 http:// 或 https:// 开头";
    return;
  }
  const sources=Array.isArray(cfg.sources)?cfg.sources.slice():[];
  if(sources.indexOf(url)!==-1){
    gstatus.textContent="该订阅源已存在";
    return;
  }
  sources.push(url);
  cfg.sources=sources;
  input.value="";
  render();
  const st=document.getElementById("gstatus-"+activeTab);
  if(st) st.textContent="已添加订阅源，记得点「保存全部」生效";
}

function delSource(index){
  const cfg=groupConfig(activeTab);
  if(!cfg) return;
  const sources=Array.isArray(cfg.sources)?cfg.sources.slice():[];
  sources.splice(index,1);
  cfg.sources=sources;
  render();
  const st=document.getElementById("gstatus-"+activeTab);
  if(st) st.textContent="已删除订阅源，记得点「保存全部」生效";
}

async function syncmerge(){
  const cfg=groupConfig(activeTab);
  if(!cfg||groupType(activeTab)!=="merge") return;
  const status=document.getElementById("gstatus-"+activeTab);
  status.textContent="正在同步…";
  const res=await api("/api/merge/sync",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({key:activeTab})
  });
  const result=await res.json();
  data=result.data;
  status.textContent="同步完成：合并 "+result.total+" 条，跳过无效行 "+result.skipped+"，每日 04:00 自动更新";
  render();
}

function addRule(group){
  const cfg=groupConfig(group);
  if(!cfg) return;
  const type=document.getElementById("type-"+group).value;
  const input=document.getElementById("value-"+group);
  const value=input.value.trim();
  if(!value) return;
  cfg.rules.push({type,value});
  input.value="";
  render();
}

function sanitizeSlug(v){
  return String(v||"").trim().toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,32);
}

function slugConflict(suffix, excludeKey){
  if(DEFAULT_KEYS.indexOf(suffix)!==-1) return true;
  return customGroups().some(g=>g.key!==excludeKey && g.suffix===suffix);
}

async function save(){
  for(const group of GROUPS){
    if(group.key==="merge") continue;
    const el=document.getElementById("name-"+group.key);
    if(el) data[group.key].name=el.value.trim() || group.title;
  }

  for(const g of customGroups()){
    const nameEl=document.getElementById("name-"+g.key);
    if(nameEl) g.name=nameEl.value.trim()||g.key;
    const descEl=document.getElementById("desc-"+g.key);
    if(descEl) g.desc=descEl.value.trim();
    const sufEl=document.getElementById("suffix-"+g.key);
    if(sufEl){
      const slug=sanitizeSlug(sufEl.value);
      if(!slug){ alert("URL 后缀不能为空"); return; }
      if(slugConflict(slug,g.key)){
        alert("URL 后缀「"+sufEl.value+"」与已有组重复（/ss-"+slug+".list 已存在）");
        return;
      }
      g.suffix=slug;
    }
  }

  const res=await api("/api/rules",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(data)
  });

  data=await res.json();
  document.getElementById("status").textContent="已保存";
  setTimeout(()=>document.getElementById("status").textContent="",1800);
  render();
}

async function logout(){
  await fetch("/api/logout",{method:"POST"});
  location.href="/";
}

async function openBackup(){
  const modal=document.getElementById("backupModal");
  modal.style.display="flex";
  document.getElementById("backupStatus").textContent="";
  await renderBackups();
}

function closeBackup(){
  document.getElementById("backupModal").style.display="none";
}

async function renderBackups(){
  const box=document.getElementById("backupList");
  box.textContent="加载中...";
  const res=await api("/api/backup");
  const list=await res.json().catch(()=>({backups:[]}));
  box.innerHTML="";
  if(!list.backups || !list.backups.length){
    box.textContent="暂无备份";
    return;
  }
  list.backups.forEach(b=>{
    const div=document.createElement("div");
    div.className="url";
    const t=new Date(b.time);
    const pad=n=>String(n).padStart(2,"0");
    const label=t.getFullYear()+"-"+pad(t.getMonth()+1)+"-"+pad(t.getDate())+" "+pad(t.getHours())+":"+pad(t.getMinutes())+":"+pad(t.getSeconds());
    const name=document.createElement("div");
    name.className="small";
    name.textContent=label;
    const row=document.createElement("div");
    row.className="urlrow";
    const btn=document.createElement("button");
    btn.textContent="恢复";
    btn.addEventListener("click",async ()=>{
      if(!confirm("确定用 "+label+" 覆盖当前所有规则？此操作不可撤销。")) return;
      const r=await api("/api/backup/restore",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({key:b.key})
      });
      const d=await r.json().catch(()=>({error:"请求失败"}));
      document.getElementById("backupStatus").textContent=d.ok?"已恢复":("恢复失败："+(d.error||""));
      if(d.ok){
        data=await api("/api/rules").then(r=>r.json()).catch(()=>data);
        render();
        closeBackup();
      }
    });
    row.appendChild(btn);
    div.appendChild(name);
    div.appendChild(row);
    box.appendChild(div);
  });
}

async function createBackup(){
  const btn=document.querySelector("#backupModal .primary");
  btn.disabled=true;
  const status=document.getElementById("backupStatus");
  status.textContent="备份中...";
  try{
    const res=await api("/api/backup",{method:"POST"});
    const d=await res.json().catch(()=>({error:"请求失败"}));
    if(d.ok){
      status.textContent="备份成功";
      await renderBackups();
    }else{
      status.textContent="备份失败："+(d.error||"");
    }
  }catch(e){
    status.textContent="备份失败";
  }
  btn.disabled=false;
}

function toggleImport(){
  const card=document.getElementById("importCard");
  card.style.display = card.style.display==="none" ? "block" : "none";
  if(card.style.display==="block"){
    document.getElementById("importStatus").textContent="";
  }
}

async function importRules(){
  const text=document.getElementById("importText").value;
  const status=document.getElementById("importStatus");
  status.textContent="";

  if(!text.trim()){
    status.textContent="请先粘贴规则文本";
    return;
  }

  const res=await api("/api/import",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({text})
  });

  const result=await res.json();

  const lines=[];
  if(result.added>0){
    lines.push("成功导入 "+result.added+" 条");
  }
  if(result.errors&&result.errors.length>0){
    lines.push("失败 "+result.errors.length+" 条：\\n"+result.errors.join("\\n"));
  }
  if(lines.length===0){
    lines.push("没有可导入的规则，请检查格式");
  }

  status.textContent=lines.join("\\n");

  if(result.data){
    data=result.data;
    render();
    document.getElementById("importText").value="";
  }
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function escapeAttr(value){
  return escapeHtml(value);
}

function openNewGroup(){
  document.getElementById("ng-type").value="rules";
  document.getElementById("ng-name").value="";
  document.getElementById("ng-desc").value="";
  document.getElementById("ng-suffix").value="";
  document.getElementById("ng-status").textContent="";
  document.getElementById("newGroupModal").style.display="flex";
  document.getElementById("ng-name").focus();
}

function closeNewGroup(){
  document.getElementById("newGroupModal").style.display="none";
}

async function createGroup(){
  const type=document.getElementById("ng-type").value;
  const name=document.getElementById("ng-name").value.trim();
  const desc=document.getElementById("ng-desc").value.trim();
  const raw=document.getElementById("ng-suffix").value;
  const status=document.getElementById("ng-status");

  if(!name){ status.textContent="请填写组名称"; return; }
  const suffix=sanitizeSlug(raw);
  if(!suffix){ status.textContent="URL 后缀不能为空（会自动加 ss- 前缀）"; return; }
  if(slugConflict(suffix,null)){
    status.textContent="URL 后缀「"+raw+"」已存在（/ss-"+suffix+".list 被占用）";
    return;
  }

  const key="c"+Date.now();
  const newGroup={key,type,name,desc,suffix,rules:[],sources:[]};
  if(!Array.isArray(data.custom)) data.custom=[];
  data.custom.push(newGroup);
  activeTab=key;
  await save();
  closeNewGroup();
}

async function delGroup(key){
  const cfg=groupConfig(key);
  if(!cfg) return;
  if(!confirm("确定删除规则组「"+(cfg.name||key)+"」？其规则与订阅地址将一并移除，默认组不受影响。")) return;
  data.custom=customGroups().filter(g=>g.key!==key);
  activeTab="proxy";
  render();
  const status=document.getElementById("status");
  if(status) status.textContent="已删除该组，记得点「保存全部」生效";
}

async function load(){
  const res=await api("/api/rules");
  data=await res.json();
  render();
}

document.getElementById("app").addEventListener("click",(event)=>{
  const btn=event.target.closest("[data-act]");
  if(!btn) return;
  const group=btn.dataset.group;
  if(btn.dataset.act==="addrule"){
    addRule(group);
  }else if(btn.dataset.act==="delrule"){
    const cfg=groupConfig(group);
    if(cfg) cfg.rules.splice(Number(btn.dataset.index),1);
    render();
  }else if(btn.dataset.act==="copygroup"){
    copyGroup(group,btn);
  }else if(btn.dataset.act==="editgroup"){
    openEdit(group);
  }else if(btn.dataset.act==="syncmerge"){
    syncmerge();
  }else if(btn.dataset.act==="addsource"){
    addSource();
  }else if(btn.dataset.act==="delsource"){
    delSource(Number(btn.dataset.index));
  }else if(btn.dataset.act==="delgroup"){
    delGroup(group);
  }
});

document.getElementById("ng-ok").addEventListener("click",createGroup);
document.getElementById("ng-cancel").addEventListener("click",closeNewGroup);
document.getElementById("newGroupModal").addEventListener("click",(event)=>{
  if(event.target.id==="newGroupModal") closeNewGroup();
});

document.getElementById("editApply").addEventListener("click",applyGroup);
document.getElementById("editCancel").addEventListener("click",closeEdit);
document.getElementById("editModal").addEventListener("click",(event)=>{
  if(event.target.id==="editModal") closeEdit();
});

load().catch(err=>{
  document.getElementById("status").textContent=err.message;
});
</script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const kv = env.RULES_KV;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
        },
      });
    }

    if (!kv) {
      return new Response("RULES_KV 未绑定", { status: 500 });
    }

    const listMatch = path.match(/^\/ss-([a-z0-9-]+)\.list$/);
    if (request.method === "GET" && listMatch) {
      const suffix = listMatch[1];
      const rules = await loadRules(kv);
      const found = findGroupBySuffix(rules, suffix);
      const body = found ? generateRuleSet(found.key, rules) : null;

      if (body === null) {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=60",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (path === "/api/login" && request.method === "POST") {
      const storedPassword = await getAdminPassword(kv, env);

      if (!storedPassword) {
        return json({ error: "管理员密码未配置，请在 KV 中设置 admin_password" }, 500);
      }

      const lock = await getLoginLock(kv);
      const remaining = loginLockRemaining(lock);

      if (remaining > 0) {
        return json({
          error: "locked",
          retryAfter: Math.ceil(remaining / 1000),
        }, 423);
      }

      try {
        const body = await request.json();

        if (body.password !== storedPassword) {
          const updated = await recordLoginFail(kv);
          const locked = loginLockRemaining(updated) > 0;
          return json({
            error: "invalid password",
            locked,
            ...(locked
              ? { retryAfter: Math.ceil(loginLockRemaining(updated) / 1000) }
              : { failsLeft: LOGIN_MAX_FAILS - updated.count }),
          }, 401);
        }

        await kv.delete(LOGIN_LOCK_KEY);

        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "Set-Cookie":
              `sr_admin=${encodeURIComponent(storedPassword)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
            "cache-control": "no-store",
          },
        });
      } catch {
        return json({ error: "invalid request" }, 400);
      }
    }

    if (path === "/api/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "Set-Cookie":
            "sr_admin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict",
          "cache-control": "no-store",
        },
      });
    }

    if (path === "/api/import" && request.method === "POST") {
      if (!(await isAdmin(request, kv, env))) {
        return json({ error: "unauthorized" }, 401);
      }

      try {
        const body = await request.json();
        const parsed = parseRuleImport(typeof body.text === "string" ? body.text : "");

        let current = await loadRules(kv);
        let added = 0;

        for (const group of GROUPS) {
          const before = current[group].rules.length;
          current[group].rules = mergeRules(current[group].rules, parsed[group]);
          added += current[group].rules.length - before;
        }

        current = await saveRules(kv, current);

        return json({ ok: true, added, errors: parsed.errors, data: current });
      } catch {
        return json({ error: "invalid request" }, 400);
      }
    }

    if (path === "/api/merge/sync" && request.method === "POST") {
      if (!(await isAdmin(request, kv, env))) {
        return json({ error: "unauthorized" }, 401);
      }
      let key = MERGE_KEY;
      try {
        const body = await request.json();
        if (typeof body.key === "string" && body.key.trim()) key = body.key.trim();
      } catch {}
      const result = await syncMergeRules(kv, key);
      if (result.error) return json({ error: result.error }, 400);
      return json({ ok: true, skipped: result.skipped, total: result.rules.length, data: result.data });
    }

    if (path === "/api/backup") {
      if (!(await isAdmin(request, kv, env))) {
        return json({ error: "unauthorized" }, 401);
      }

      if (request.method === "GET") {
        return json({ backups: await listBackups(kv) });
      }

      if (request.method === "POST") {
        const key = await createBackup(kv);
        return json({ ok: true, backups: await listBackups(kv), key });
      }
    }

    if (path === "/api/backup/restore" && request.method === "POST") {
      if (!(await isAdmin(request, kv, env))) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const body = await request.json();
        const result = await restoreBackup(kv, body && body.key);
        if (result.error) return json({ error: result.error }, 400);
        return json({ ok: true, data: result.rules });
      } catch {
        return json({ error: "invalid request" }, 400);
      }
    }

    if (path === "/api/rules") {
      if (!(await isAdmin(request, kv, env))) {
        return json({ error: "unauthorized" }, 401);
      }

      if (request.method === "GET") {
        return json(await loadRules(kv));
      }

      if (request.method === "POST") {
        try {
          const body = await request.json();
          return json(await saveRules(kv, body));
        } catch {
          return json({ error: "invalid request" }, 400);
        }
      }
    }

    if (path === "/" || path === "/admin") {
      if (!(await isAdmin(request, kv, env))) {
        return html(getLoginHTML());
      }

      return html(getAdminHTML());
    }

    return new Response("Not Found", { status: 404 });
  },
  async scheduled(_event, env) {
    const kv = env.RULES_KV;
    if (!kv) return;
    await syncAllMergeRules(kv);
  },
};
