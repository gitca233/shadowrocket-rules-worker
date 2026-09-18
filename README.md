# Shadowrocket Rules Worker

一个个人使用的 **Shadowrocket（SS）规则管理工具**，部署在 Cloudflare Workers（免费计划）。

**初衷**：Shadowrocket 的规则文件要在手机上手动维护、多设备同步麻烦。本工具提供一个**网页后台**，让你在任何设备上打开浏览器就能增删改规则——改完自动生成标准 RULE-SET 订阅，手机端只需填入一个订阅地址，规则即时生效。

## 功能

- **Web 管理后台**：密码登录后，网页上在线维护全部规则（无需编辑文件）
- **登录防爆破**：连续 5 次密码错误自动锁定 15 分钟（KV 记录 `login_lock`），到期自动解除；删除该 KV 记录可立即解除锁定
- **备份 / 恢复**：顶栏「备份/恢复」可手动备份当前全部规则（存 KV，最多保留最近 10 份），误操作后可一键恢复到任意备份
- **多组规则**：默认四组始终保留——代理（proxy）/ 直连（direct）/ 拦截（reject）/ 合并订阅（merge）
- **自定义规则组**：点击「新建规则组」任意增加**自定义规则**或**合并订阅**类型组，可自定义组名称、说明与 URL 后缀（自动加 `ss-` 前缀并检查重复），删除自定义组不影响默认组
- **订阅地址自动同步**：后台右侧「Shadowrocket RULE-SET」一列展示所有组的订阅地址，点击复制即可填进手机
- **8 种规则类型**：
  - `DOMAIN-SUFFIX`（域名后缀）
  - `DOMAIN-KEYWORD`（域名关键字）
  - `DOMAIN-WILDCARD`（域名通配符，如 `*.example.com`）
  - `DOMAIN`（精确域名）
  - `IP-CIDR`（IPv4 网段，自动加 `no-resolve`）
  - `IP-CIDR6`（IPv6 网段，自动加 `no-resolve`）
  - `IP-ASN`（ASN 号，自动加 `no-resolve`）
  - `GEOIP`（国家代码）
- 管理页操作：
  - 逐条新增（类型下拉 + 输入 + 添加）、删除
  - **文本编辑**：弹窗里全组规则以文本形式直接改，每行 `类型,值`，应用即保存
  - **复制文本**：一键复制整组规则（默认组带策略列，可直接再导入；自定义组不含策略，由你在 SS 里指定）
  - **批量导入**：粘贴多行 `类型,值,策略`，按策略自动分配到默认三组
  - 顶栏操作按钮固定，滚动时始终可见，防止忘记保存
- **合并订阅**：把多个远程 RULE-SET 订阅源拉取、去重合并成一个文件；可手动「立即同步」，也可加入每日 04:00 自动同步（Cron）
- 自动生成 Shadowrocket 标准 `RULE-SET` 订阅，接口无需密码，直接填入 Shadowrocket

## 项目结构

```text
shadowrocket-rules-worker/
├── worker.js        # Worker 主程序（管理面板 + RULE-SET 生成 + KV 存储）
├── wrangler.jsonc   # Cloudflare 配置（Worker 名称、KV 绑定）
├── package.json     # 构建脚本（wrangler）
└── README.md
```

## 存储

规则数据保存在 **Cloudflare Workers KV**（免费计划可用）。

- KV 命名空间建议名称：`RULES_STORAGE`
- 绑定变量名固定为：`RULES_KV`（代码里写死，不可改动）
- KV 命名空间 id 已写入 `wrangler.jsonc`

> KV 里的规则数据与代码相互独立。每次重新构建、重新部署只更新代码，**不会清空 KV 数据**。

## 首次部署

### 1. 代码推送到 GitHub

```bash
git init -b main
git add -A
git commit -m "init"
git remote add origin git@github.com:gitca233/shadowrocket-rules-worker.git
git push -u origin main
```

### 2. 创建 KV 命名空间

Cloudflare 控制台 → **存储和数据库** → **Workers KV** → **创建命名空间**：

- 命名空间名：`RULES_STORAGE`
- 复制它的 **Namespace ID**

把 id 填入 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  {
    "binding": "RULES_KV",
    "id": "这里填你的 Namespace ID"
  }
]
```

### 3. 导入仓库部署

Cloudflare 控制台 → **Workers 和 Pages** → **创建** → **导入 GitHub 仓库**：

- 选择 `gitca233/shadowrocket-rules-worker`
- 如列表没有该仓库，点「添加账户」重新授权（安装 Cloudflare Workers and Pages GitHub App）
- 点击 **保存并部署**

部署后绑定自定义域（可选）：Worker → 设置 → 域与路由。

### 4. 设置管理员密码（二选一）

**方式 A（推荐）：写入 KV**

Cloudflare 控制台 → 打开 `shadowrocket-rules-worker` → **KV** → 打开 `RULES_STORAGE` → **添加条目**：

```text
键：admin_password
值：你的管理员密码
```

代码优先读 KV 的 `admin_password`，写入后登录立即生效，无需重新部署。

**方式 B：环境变量（兜底）**

Worker → **设置** → **变量和机密信息** → 添加：

```text
类型: Secret（机密）
名称: ADMIN_PASSWORD
值:   你的管理员密码
```

代码在没有 KV 条目时读取 `env.ADMIN_PASSWORD` 兜底。

> ⚠️ **方式 B 的坑：添加 Secret 后必须触发一次「新的部署」，Secret 才会注入到运行时**（例如 push 一次代码触发自动构建）。若长期使用，推荐方式 A，免去重新部署。

### 5. 验证

```bash
curl -i -X POST https://你的域名/api/login \
  -H "Content-Type: application/json" \
  -d '{"password":"你的密码"}'
```

- `HTTP/2 200` → 成功
- `HTTP/2 401 invalid password` → 密码不匹配（检查是否有空格/特殊字符）
- `HTTP/2 500 ADMIN_PASSWORD 未配置` → 密码未生效，按第 4 步配置

## 以后更新代码（自动部署）

修改任何文件（包括用 AI 改 `worker.js`）后：

```bash
git add -A
git commit -m "update"
git push origin main
```

Cloudflare Workers Builds 会自动拉取、重新构建、重新部署。**KV 里的规则数据不受影响。**

## 使用

### 管理规则

```text
https://你的域名/
```

登录后左侧为规则组列表，带图标便于区分：默认组（🛡️代理规则 / 🌐直连规则 / 🚫拦截规则 / 🔀合并订阅）始终保留；点「+ 新建规则组」可添加自定义组（📋自定义规则 / 📦合并订阅），自定义组可自定义名称、说明与 URL 后缀（自动加 `ss-` 前缀并检查重复）。

顶栏的「保存全部」固定可见；也支持文本编辑、复制、批量导入。

### Shadowrocket 订阅（无需密码）

```text
https://你的域名/ss-proxy.list
https://你的域名/ss-direct.list
https://你的域名/ss-reject.list
https://你的域名/ss-merge.list
https://你的域名/ss-<自定义后缀>.list
```

### 合并订阅（merge）

把多个远程 RULE-SET 订阅源合并成一个文件：默认「合并订阅」及新建的「合并订阅」类型自定义组都会参与每日 04:00 自动同步，也可在卡片内点「立即同步」手动触发。

```text
[Rule]
RULE-SET,https://你的域名/ss-merge.list,PROXY
```

- 无效行（类型不支持、格式错误）自动跳过，同步结果显示跳过数量
- 合并结果只读，由同步生成，不在管理页手动编辑

### Shadowrocket 配置示例

```text
[General]
# ...

[Rule]
RULE-SET,https://你的域名/ss-proxy.list,PROXY
RULE-SET,https://你的域名/ss-direct.list,DIRECT
RULE-SET,https://你的域名/ss-reject.list,REJECT
```

### 批量导入格式

每行一条，策略 `PROXY` / `DIRECT` / `REJECT`，自动分配到对应组：

```text
DOMAIN-SUFFIX,yfamilys.com,PROXY
DOMAIN-SUFFIX,eteams.cn,DIRECT
DOMAIN-KEYWORD,ads.example.com,REJECT
IP-CIDR,192.168.0.0/24,DIRECT
```

- 跳过空行和 `#` / `//` / `;` 注释行
- 重复规则自动去重
- 未知类型、缺少值、无法识别的策略会按行报错

## 注意

- 这是个人使用的小型规则管理器
- 管理员会话使用 HttpOnly + Secure + SameSite=Strict Cookie
- 登录防爆破：连续 5 次错误锁定 15 分钟，锁定记录存 KV 键 `login_lock`；如需提前解锁，在 Cloudflare 控制台删除该键即可
- 备份存 KV 键 `backup:<时间戳>`，最多保留最近 10 份，超出自动清理；恢复会覆盖当前全部规则
- 各规则组的 `.list` 接口保持公开，供 Shadowrocket 直接拉取
- 不要把密码值写进 GitHub（用 KV `admin_password` 或 Cloudflare Secret）
- KV 的 Namespace ID 不是机密信息，可以随 `wrangler.jsonc` 进仓库
- Cron 触发器（每日 04:00 同步）配置在 `wrangler.jsonc`，免费计划支持每天一次