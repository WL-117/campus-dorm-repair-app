# 校园宿舍线上报修 APP —— 后端服务

基于 **Node.js 内置 http 模块 + MySQL 8.0** 实现的后端服务。
接口与前端 `common/api.uts`、`common/mock-server.uts` 完全对齐（同一套 URL、同一套 `ApiResult` 返回结构），前端只需改一个开关即可在「真实后端 / 模拟后端」之间切换。

## 一、目录结构

```
server/
├─ server.js              服务入口：HTTP 监听、跨域、请求体解析、参数合并、请求日志
├─ config.js              配置：读取 .env，输出端口与数据库连接参数
├─ routes.js              路由层：15 个 RESTful 接口 + 健康检查 + 8 个管理端接口（全部 async）
├─ db.js                  数据层：MySQL 连接池、建库建表、查询/变更为 Prepared Statement
├─ schema.sql             表结构 DDL（可直接用 mysql 命令行或 Navicat 执行）
├─ scripts/
│  └─ import-json.js      把旧版 data/db.json 迁移进 MySQL（可重复执行）
├─ test.js                接口自测脚本（纯 HTTP 调用，覆盖全部接口与异常分支）
├─ .env.example           环境变量模板（复制为 .env 后填写）
├─ package.json           依赖与脚本命令
└─ data/
   └─ db.json             旧版 JSON 数据文件（现在只作为迁移来源，服务不再读写）
```

## 二、环境准备

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18 | 只需 Node，其余依赖由 `npm install` 安装 |
| MySQL | 8.0 | 默认连接 `127.0.0.1:3306` |

1. 确认 MySQL 服务已启动（Windows 服务名通常为 `MySQL80`）。
2. 复制环境变量模板并填写自己的账号密码：

```bash
# Windows
copy .env.example .env
# macOS / Linux
cp .env.example .env
```

```ini
PORT=3000
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=dorm_repair
DB_POOL=10
```

> `.env` 已写入 `.gitignore`，不会提交到仓库；不要把密码写进代码或文档。

## 三、运行方式

```bash
# 1. 安装依赖（只有一个：mysql2）
npm install

# 2. 初始化数据库：自动建库 dorm_repair + 建三张表
npm run db:init

# 3. 可选：把旧版 JSON 数据迁移进来（同 ID 覆盖，可重复执行）
npm run db:import

# 4. 启动服务（默认 3000 端口）
npm start
# 或
node server.js

# 5. 换端口启动（Windows 用 set PORT=3001）
#    也可以直接双击 start-server.bat
PORT=3001 node server.js

# 6. 接口自测（另开一个终端，需保持服务运行）
npm test
node test.js http://192.168.1.100:3000/api     # 指定地址

# 7. 数据恢复为演示数据（清空三张表后重新写入）
npm run reset
```

启动成功后控制台会输出可用访问地址与数据库：

```
本机访问：          http://127.0.0.1:3000/api
局域网 / 真机访问： http://192.168.x.x:3000/api
Android 模拟器：    http://10.0.2.2:3000/api
数据库：            mysql://root@127.0.0.1:3306/dorm_repair
```

浏览器直接访问 `http://127.0.0.1:3000/api/health` 可验证服务与数据库是否正常（返回三张表的行数）。

## 四、接口清单

统一返回：`{ code, message, data }`，`code = 0` 表示业务成功，`code != 0` 时 `message` 为可直接展示给用户的提示语。

| 序号 | 方法 | 接口 | 说明 |
| --- | --- | --- | --- |
| 1 | POST | `/user/register` | 用户注册（新增） |
| 2 | POST | `/user/login` | 用户登录，返回 `token` + `userInfo` |
| 3 | GET | `/user/info` | 查询用户信息 |
| 4 | PUT | `/user/update` | 修改用户信息（修改） |
| 5 | POST | `/repair/create` | 提交报修（新增） |
| 6 | GET | `/repair/list` | 工单列表（分页 + 状态筛选 + 关键字查询） |
| 7 | GET | `/repair/detail` | 工单详情 |
| 8 | PUT | `/repair/update` | 修改工单 |
| 9 | POST | `/repair/cancel` | 取消报修 |
| 10 | DELETE | `/repair/delete` | 删除工单（删除） |
| 11 | GET | `/stat/mine` | 个人工单统计 |
| 12 | GET | `/category/list` | 故障分类（常用数据） |
| 13 | GET | `/tips/list` | 常见故障提示 |
| 14 | GET | `/notice/list` | 公告列表 |
| 15 | GET | `/notice/detail` | 公告详情 |
| 16 | GET | `/health` | 服务健康检查（含三张表行数） |

### 管理端接口（需管理员角色）

| 序号 | 方法 | 接口 | 说明 |
| --- | --- | --- | --- |
| 1 | GET | `/admin/stat` | 平台总览统计（用户数、工单各状态数、紧急工单、今日新增等） |
| 2 | GET | `/admin/user/list` | 用户列表（分页 + 角色筛选 + 关键字，附带每人工单数） |
| 3 | DELETE | `/admin/user/delete` | 注销用户（外键级联删除其工单，保留最后一个管理员） |
| 4 | GET | `/admin/order/list` | 工单管理列表（分页 + 状态筛选 + 关键字） |
| 5 | PUT | `/admin/order/status` | 推进工单状态（待处理 → 维修中 → 已完成） |
| 6 | PUT | `/admin/order/remark` | 填写处理备注（写入工单进度日志） |
| 7 | POST | `/admin/notice/create` | 发布公告 |
| 8 | PUT | `/admin/notice/update` | 修改公告 |
| 9 | DELETE | `/admin/notice/delete` | 删除公告 |

管理端接口统一做角色校验：非管理员账号调用会返回 `code != 0`（提示「无管理员权限，请使用管理员账号登录」）。

约定：

- `query` 与 `body` 参数都会合并解析（`body` 优先），GET / DELETE 两种传参方式都能正常使用；
- 登录凭证可放在请求头 `token`，也可作为参数 `token` 传递；缺省时可用 `userId` 定位用户；
- 业务失败一律返回 HTTP 200 + `code != 0`，前端统一用 `code` 判断，无需处理 HTTP 状态码；
- 分页、状态筛选、关键字搜索、统计聚合全部下推到 SQL 执行（`LIMIT / OFFSET`、`LIKE`、`SUM(CASE)`）。

## 五、数据库设计

库名 `dorm_repair`，字符集 `utf8mb4`，三张 InnoDB 表（完整 DDL 见 `schema.sql`）：

| 表名 | 说明 | 主要字段 |
| --- | --- | --- |
| `t_user` | 用户表 | id、username（唯一）、password、nickname、phone、avatar、gender、dorm、**role（student / admin）**、create_time |
| `t_repair_order` | 报修工单表 | id、order_no（唯一）、user_id（外键）、user_name、category、building、room、contact、description、images、level、status、create_time、update_time、remark、logs（JSON） |
| `t_notice` | 公告表 | id、title、content、time、tag |

设计与注意事项：

- **排序稳定**：三张表都有自增 `seq` 列。工单、公告按 `seq DESC`（等价于原版本「新数据置顶」），用户按 `seq ASC`。
- **索引**：`uk_username`（账号唯一）、`idx_phone`、`idx_role`、`idx_user`、`idx_status_time`（状态 + 创建时间）、`idx_level`、`idx_time`。
- **外键**：`t_repair_order.user_id → t_user.id`，`ON DELETE CASCADE`，所以「注销用户」时其名下工单自动级联删除，不需要业务层再清理。
- **日志字段**：`logs` 存 JSON 数组 `[{time, content}]`，对外仍按 `time::content|...` 拼接成字符串（与前端 `convert.uts` 一致）。
- **时间字段**为 `VARCHAR(20)` 存 `yyyy-MM-dd HH:mm`，与前端展示格式严格一致，避免时区与格式二次转换。

演示数据（`t_user` 为空时 `db:init` 自动写入）：

- 用户：`admin / 123456`（宿舍管理中心，管理员）、`student / 123456`、`xiaoyu / 123456`
- 工单：`o_2001` ~ `o_2007`，覆盖待处理 / 维修中 / 已完成 / 已取消四种状态
- 公告：`n_1` ~ `n_3`

## 六、前端接入（切换真实后端）

前端请求层 `common/http.uts` 已默认连接真实后端（`USE_REAL_SERVER = true`），
并内置**多地址自动探测**：按顺序尝试下列地址，首次连通后记住该地址，后续请求直接复用，
因此模拟器 / 真机 / H5 三种运行方式都无需手动改 IP。

```uts
/** 数据源开关：true = 连接真实后端；false = 使用本地模拟后端 */
export const USE_REAL_SERVER : boolean = true

/** 真实后端候选地址（按顺序自动探测） */
export const REAL_BASE_URLS : string[] = [
  'http://127.0.0.1:3000/api',     // H5 端 / 电脑本机浏览器
  'http://10.0.2.2:3000/api',      // Android 模拟器（访问电脑本机）
  'http://192.168.6.1:3000/api',   // 真机运行：电脑局域网 IP 候选 1
  'http://10.128.228.36:3000/api', // 真机运行：电脑局域网 IP 候选 2
  'http://172.16.18.1:3000/api'    // 真机运行：电脑局域网 IP 候选 3
]
```

| 运行端 | 命中地址 |
| --- | --- |
| Android 模拟器 | `http://10.0.2.2:3000/api` |
| Android / iOS 真机 | 三个局域网 IP 之一（启动服务时控制台会打印） |
| H5 端 | `http://127.0.0.1:3000/api` |

> 只想固定一个地址时，把其它候选行删掉即可；后端没启动会依次超时，最终提示「连接后端失败」。

### 防火墙

真机访问需要放行本机 3000 端口，管理员 PowerShell 执行一次即可（生效后可以删除）：

```powershell
New-NetFirewallRule -DisplayName "校园宿舍报修后端 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any
```

## 七、常见问题

1. **`Access denied for user ...`**：`.env` 里的 `DB_USER` / `DB_PASSWORD` 不对，或该账号没有建库权限。
2. **`ER_BAD_DB_ERROR` / 表不存在**：先跑一次 `npm run db:init`（它会自动 `CREATE DATABASE IF NOT EXISTS dorm_repair` 并建表）。
3. **端口被占用**：`PORT=3001 node server.js` 换端口，前端 `REAL_BASE_URL` 同步修改。
4. **真机连不上**：确认使用局域网 IP、防火墙已放行、手机与电脑同一网段；可先用手机浏览器访问 `http://IP:3000/api/health` 验证。
5. **数据想回到初始状态**：`npm run reset`（清空三张表并重新写入演示数据）。
6. **想用 Navicat 看数据**：新建 MySQL 连接，主机 `127.0.0.1`、端口 `3306`，打开 `dorm_repair` 库即可。
7. **Android 9+ 明文 HTTP 被拦截**：Android 9 起默认禁止明文流量，若真机报 `ERR_CLEARTEXT_NOT_PERMITTED`，可在 `manifest.json` 源码视图的 `app-android` 节点中增加 `"hasCleartextTraffic": true`（或在 AndroidManifest.xml 的 application 节点加 `android:usesCleartextTraffic="true"`）后重新打包/运行。
