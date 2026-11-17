'use strict'
/**
 * 后端数据层（Database / DAO）—— MySQL 版
 * ------------------------------------------------------------------
 * 1. 三张表与前端 common/mock-server.uts 完全对齐：
 *      t_user         用户表
 *      t_repair_order 报修工单表
 *      t_notice       公告表
 * 2. 存储：MySQL 8.0（表结构见 server/schema.sql），连接信息见 server/.env
 * 3. 首次启动自动建库建表，并在三张表为空时写入演示数据（seed）
 * 4. 路由层只调用本文件暴露的「查询 / 变更」方法，不直接写 SQL；
 *    列表分页、状态筛选、关键字搜索、统计全部下推到数据库执行
 */

const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
const config = require('./config')

const SCHEMA_FILE = path.join(__dirname, 'schema.sql')
let pool = null

/* ------------------------------ 通用工具方法 ------------------------------ */
/* 说明：以下方法与前端 common/util.uts 实现保持一致，保证两端生成的数据格式完全相同 */

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 时间戳 -> yyyy-MM-dd HH:mm */
function formatTime(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 当前时间字符串 */
function nowTime() {
  return formatTime(Date.now())
}

/** 手机号正则：1 开头，第二位 3~9，共 11 位 */
function isPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || ''))
}

/** 生成唯一 ID */
function genId(prefix) {
  return prefix + Date.now() + Math.floor(Math.random() * 10000)
}

/** 生成工单编号：BX + 年月日时分秒 + 随机三位 */
function genOrderNo() {
  const d = new Date()
  return 'BX' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) +
    Math.floor(Math.random() * 900 + 100)
}

/** 数组按分隔符拼接 */
function joinStr(list, sep) {
  return (list || []).join(sep)
}

/** 字符串按分隔符拆分 */
function splitStr(text, sep) {
  if (!text) return []
  return String(text).split(sep)
}

/** 图片字段兼容：既支持数组，也支持逗号分隔字符串 */
function toArray(value) {
  if (Array.isArray(value)) return value
  return splitStr(value, ',').filter(function (s) { return s.length > 0 })
}

/** LIKE 关键字转义，避免用户输入 % _ 造成意外匹配 */
function escapeLike(keyword) {
  return String(keyword).replace(/[\\%_]/g, function (m) { return '\\' + m })
}

/* --------------------------------- 常量 ---------------------------------- */

/** 默认故障分类（常用数据） */
const DEFAULT_CATEGORIES = ['水电维修', '门窗家具', '网络宽带', '空调电器', '公共设施', '其他问题']

/** 常见故障提示（常用数据） */
const DEFAULT_TIPS = [
  { title: '宿舍突然断电', desc: '先查看是否使用大功率电器导致跳闸，拔掉电器后到楼层配电箱复位闸刀，仍未恢复请报修。' },
  { title: '水龙头漏水', desc: '先关闭下方角阀，用容器接水，再选择「水电维修」提交工单并上传漏水点照片。' },
  { title: '宿舍网速很慢', desc: '重启光猫和路由器，检查网线是否松动，仍异常请选择「网络宽带」报修。' },
  { title: '空调不制冷', desc: '确认模式为制冷且温度低于室温，清洗滤网后仍异常请选择「空调电器」报修。' },
  { title: '门锁损坏', desc: '请勿强行撬锁，先在宿管处登记，再提交「门窗家具」类紧急工单。' }
]

/* ------------------------------ 行 <-> 对象 ------------------------------- */

/** t_user 行 -> 用户对象（与 JSON 版本字段完全一致） */
function rowToUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    nickname: row.nickname,
    phone: row.phone,
    avatar: row.avatar,
    gender: row.gender,
    dorm: row.dorm,
    role: row.role || 'student',
    createTime: row.create_time
  }
}

/** t_repair_order 行 -> 工单对象（logs 从 JSON 字符串还原为数组） */
function rowToOrder(row) {
  if (!row) return null
  let logs = []
  try {
    const parsed = JSON.parse(row.logs || '[]')
    if (Array.isArray(parsed)) logs = parsed
  } catch (e) {
    logs = []
  }
  return {
    id: row.id,
    orderNo: row.order_no,
    userId: row.user_id,
    userName: row.user_name,
    category: row.category,
    building: row.building,
    room: row.room,
    contact: row.contact,
    description: row.description,
    images: row.images,
    level: row.level,
    status: String(row.status),
    createTime: row.create_time,
    updateTime: row.update_time,
    remark: row.remark,
    logs: logs
  }
}

/** t_notice 行 -> 公告对象 */
function rowToNotice(row) {
  if (!row) return null
  return { id: row.id, title: row.title, content: row.content, time: row.time, tag: row.tag }
}

/* ------------------------------ 连接与初始化 ------------------------------ */

/** 建库（库不存在时创建） */
async function ensureDatabase() {
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    charset: config.mysql.charset,
    multipleStatements: true
  })
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS `' + config.mysql.database +
      '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  } finally {
    await conn.end()
  }
}

/** 建表：执行 schema.sql（全部为 CREATE TABLE IF NOT EXISTS，可重复执行） */
async function ensureSchema() {
  if (!fs.existsSync(SCHEMA_FILE)) throw new Error('缺少表结构文件 server/schema.sql')
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8')
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    charset: config.mysql.charset,
    multipleStatements: true
  })
  try {
    await conn.query(sql)
  } finally {
    await conn.end()
  }
}

/** 初始化：建库 -> 连接池 -> 建表 -> 空库时写入演示数据 */
async function init() {
  await ensureDatabase()
  pool = mysql.createPool(Object.assign({}, config.mysql, { database: config.mysql.database }))
  await ensureSchema()
  const c = await counts()
  if (c.users === 0 && c.orders === 0 && c.notices === 0) {
    await seed()
  }
}

function getPool() {
  if (!pool) throw new Error('数据库连接池尚未初始化，请先调用 db.init()')
  return pool
}

/** 关闭连接池（进程退出时调用） */
async function close() {
  if (!pool) return
  await pool.end()
  pool = null
}

/* -------------------------------- 用户查询 -------------------------------- */

async function getUser(id) {
  if (!id) return null
  const [rows] = await getPool().execute('SELECT * FROM t_user WHERE id = ? LIMIT 1', [id])
  return rowToUser(rows[0])
}

/** 账号或手机号登录 */
async function getUserByAccount(account) {
  const [rows] = await getPool().execute(
    'SELECT * FROM t_user WHERE username = ? OR phone = ? LIMIT 1', [account, account])
  return rowToUser(rows[0])
}

async function getUserByUsername(username) {
  const [rows] = await getPool().execute('SELECT * FROM t_user WHERE username = ? LIMIT 1', [username])
  return rowToUser(rows[0])
}

async function getUserByPhone(phone) {
  const [rows] = await getPool().execute('SELECT * FROM t_user WHERE phone = ? LIMIT 1', [phone])
  return rowToUser(rows[0])
}

/**
 * 用户列表（分页 + 角色筛选 + 关键字：昵称 / 账号 / 手机号 / 宿舍）
 * 每条记录附带该用户的工单数量（子查询直接下推到数据库）
 */
async function listUsers(opts) {
  const where = []
  const args = []
  if (opts.role) {
    where.push('u.role = ?')
    args.push(opts.role)
  }
  if (opts.keyword) {
    const kw = '%' + escapeLike(opts.keyword) + '%'
    where.push('(u.nickname LIKE ? OR u.username LIKE ? OR u.phone LIKE ? OR u.dorm LIKE ?)')
    args.push(kw, kw, kw, kw)
  }
  const whereSql = where.length > 0 ? ' WHERE ' + where.join(' AND ') : ''

  const [countRows] = await getPool().execute('SELECT COUNT(*) AS total FROM t_user u' + whereSql, args)
  const total = Number(countRows[0].total || 0)

  const limit = Number(opts.size)
  const offset = (Number(opts.page) - 1) * limit
  const [rows] = await getPool().execute(
    'SELECT u.*, (SELECT COUNT(*) FROM t_repair_order o WHERE o.user_id = u.id) AS order_count' +
    ' FROM t_user u' + whereSql + ' ORDER BY u.seq ASC LIMIT ' + limit + ' OFFSET ' + offset,
    args)
  return { rows: rows, total: total }
}

/** 管理员数量（用于保护最后一个管理员账号） */
async function countAdmins() {
  const [rows] = await getPool().execute("SELECT COUNT(*) AS c FROM t_user WHERE role = 'admin'")
  return Number(rows[0].c || 0)
}

async function addUser(user) {
  await getPool().execute(
    'INSERT INTO t_user (id, username, password, nickname, phone, avatar, gender, dorm, role, create_time)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [user.id, user.username, user.password, user.nickname, user.phone, user.avatar,
      user.gender, user.dorm, user.role, user.createTime])
  return user
}

/** 按白名单字段更新用户信息 */
async function updateUser(id, patch) {
  const sets = []
  const args = []
  ;['nickname', 'avatar', 'gender', 'dorm', 'phone'].forEach(function (key) {
    if (patch[key] !== undefined) {
      sets.push(key + ' = ?')
      args.push(patch[key])
    }
  })
  if (sets.length === 0) return getUser(id)
  args.push(id)
  await getPool().execute('UPDATE t_user SET ' + sets.join(', ') + ' WHERE id = ?', args)
  return getUser(id)
}

/** 删除用户（t_repair_order 有 ON DELETE CASCADE 外键，其名下工单自动级联删除） */
async function removeUser(id) {
  await getPool().execute('DELETE FROM t_user WHERE id = ?', [id])
}

/* -------------------------------- 工单查询 -------------------------------- */

async function getOrder(id) {
  if (!id) return null
  const [rows] = await getPool().execute('SELECT * FROM t_repair_order WHERE id = ? LIMIT 1', [id])
  return rowToOrder(rows[0])
}

/**
 * 工单列表（分页 + 状态筛选 + 关键字查询 + 只看本人）
 * @param {object} opts { userId, status, keyword, page, size, admin }
 *   admin = true 时关键字额外匹配「提交人昵称」与「楼栋+宿舍号」（与前端管理端一致）
 */
async function listOrders(opts) {
  const where = []
  const args = []
  if (opts.userId) {
    where.push('user_id = ?')
    args.push(opts.userId)
  }
  if (opts.status) {
    where.push('status = ?')
    args.push(opts.status)
  }
  if (opts.keyword) {
    const kw = '%' + escapeLike(opts.keyword) + '%'
    if (opts.admin) {
      where.push('(order_no LIKE ? OR description LIKE ? OR category LIKE ? OR user_name LIKE ? OR CONCAT(building, room) LIKE ?)')
      args.push(kw, kw, kw, kw, kw)
    } else {
      where.push('(order_no LIKE ? OR description LIKE ? OR category LIKE ?)')
      args.push(kw, kw, kw)
    }
  }
  const whereSql = where.length > 0 ? ' WHERE ' + where.join(' AND ') : ''

  const [countRows] = await getPool().execute('SELECT COUNT(*) AS total FROM t_repair_order' + whereSql, args)
  const total = Number(countRows[0].total || 0)

  const limit = Number(opts.size)
  const offset = (Number(opts.page) - 1) * limit
  const [rows] = await getPool().execute(
    'SELECT * FROM t_repair_order' + whereSql + ' ORDER BY seq DESC LIMIT ' + limit + ' OFFSET ' + offset, args)
  return { rows: rows.map(rowToOrder), total: total }
}

/** 按状态统计某个用户的工单数量（个人中心统计） */
async function countOrdersByStatus(userId) {
  const stat = { total: 0, pending: 0, doing: 0, done: 0, canceled: 0 }
  if (!userId) return stat
  const [rows] = await getPool().execute(
    'SELECT status, COUNT(*) AS c FROM t_repair_order WHERE user_id = ? GROUP BY status', [userId])
  rows.forEach(function (row) {
    const n = Number(row.c || 0)
    stat.total += n
    if (row.status === '0') stat.pending = n
    if (row.status === '1') stat.doing = n
    if (row.status === '2') stat.done = n
    if (row.status === '3') stat.canceled = n
  })
  return stat
}

async function addOrder(order) {
  await getPool().execute(
    'INSERT INTO t_repair_order (id, order_no, user_id, user_name, category, building, room, contact,' +
    ' description, images, level, status, create_time, update_time, remark, logs)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [order.id, order.orderNo, order.userId, order.userName, order.category, order.building,
      order.room, order.contact, order.description, joinStr(toArray(order.images), ','),
      order.level, order.status, order.createTime, order.updateTime, order.remark || '',
      JSON.stringify(order.logs || [])])
  return order
}

/**
 * 更新工单
 * @param {string} id
 * @param {object} patch   可含 description / room / contact / status / remark / updateTime
 * @param {object} logItem 需要追加的进度日志 { time, content }
 */
async function updateOrder(id, patch, logItem) {
  const order = await getOrder(id)
  if (!order) return null
  ;['description', 'room', 'contact', 'status', 'remark'].forEach(function (key) {
    if (patch[key] !== undefined) order[key] = patch[key]
  })
  order.updateTime = patch.updateTime || nowTime()
  if (logItem) order.logs.push(logItem)
  await getPool().execute(
    'UPDATE t_repair_order SET description = ?, room = ?, contact = ?, status = ?, remark = ?,' +
    ' update_time = ?, logs = ? WHERE id = ?',
    [order.description, order.room, order.contact, order.status, order.remark,
      order.updateTime, JSON.stringify(order.logs), id])
  return order
}

async function removeOrder(id) {
  await getPool().execute('DELETE FROM t_repair_order WHERE id = ?', [id])
}

/* -------------------------------- 公告查询 -------------------------------- */

async function listNotices() {
  const [rows] = await getPool().execute('SELECT * FROM t_notice ORDER BY seq DESC')
  return rows.map(rowToNotice)
}

async function getNotice(id) {
  if (!id) return null
  const [rows] = await getPool().execute('SELECT * FROM t_notice WHERE id = ? LIMIT 1', [id])
  return rowToNotice(rows[0])
}

async function addNotice(notice) {
  await getPool().execute(
    'INSERT INTO t_notice (id, title, content, time, tag) VALUES (?, ?, ?, ?, ?)',
    [notice.id, notice.title, notice.content, notice.time, notice.tag])
  return notice
}

async function updateNotice(id, patch) {
  const notice = await getNotice(id)
  if (!notice) return null
  ;['title', 'content', 'tag'].forEach(function (key) {
    if (patch[key] !== undefined) notice[key] = patch[key]
  })
  await getPool().execute(
    'UPDATE t_notice SET title = ?, content = ?, tag = ? WHERE id = ?',
    [notice.title, notice.content, notice.tag, id])
  return notice
}

async function removeNotice(id) {
  await getPool().execute('DELETE FROM t_notice WHERE id = ?', [id])
}

/* --------------------------------- 统计 ---------------------------------- */

/** 三张表的总行数（健康检查用） */
async function counts() {
  const [[u], [o], [n]] = await Promise.all([
    getPool().execute('SELECT COUNT(*) AS c FROM t_user'),
    getPool().execute('SELECT COUNT(*) AS c FROM t_repair_order'),
    getPool().execute('SELECT COUNT(*) AS c FROM t_notice')
  ])
  return {
    users: Number(u[0].c || 0),
    orders: Number(o[0].c || 0),
    notices: Number(n[0].c || 0)
  }
}

/** 平台总览统计（管理端）：一次聚合查询完成状态 / 紧急 / 今日统计 */
async function adminStat() {
  const today = nowTime().substring(0, 10)
  const [[orderRow], [userRows], [noticeRows]] = await Promise.all([
    getPool().execute(
      'SELECT COUNT(*) AS total,' +
      " SUM(status = '0') AS pending, SUM(status = '1') AS doing," +
      " SUM(status = '2') AS done, SUM(status = '3') AS canceled," +
      " SUM(level = '紧急') AS urgent, SUM(LEFT(create_time, 10) = ?) AS today_orders" +
      ' FROM t_repair_order', [today]),
    getPool().execute('SELECT role, COUNT(*) AS c FROM t_user GROUP BY role'),
    getPool().execute('SELECT COUNT(*) AS c FROM t_notice')
  ])

  const stat = {
    users: 0, students: 0, admins: 0,
    orders: Number(orderRow[0].total || 0),
    pending: Number(orderRow[0].pending || 0),
    doing: Number(orderRow[0].doing || 0),
    done: Number(orderRow[0].done || 0),
    canceled: Number(orderRow[0].canceled || 0),
    urgent: Number(orderRow[0].urgent || 0),
    todayOrders: Number(orderRow[0].today_orders || 0),
    notices: Number(noticeRows[0].c || 0)
  }
  userRows.forEach(function (row) {
    const n = Number(row.c || 0)
    stat.users += n
    if (row.role === 'admin') stat.admins = n
    else stat.students += n
  })
  return stat
}

/* ------------------------------ 输出序列化 -------------------------------- */

/** 脱敏：去掉密码，只返回对外用户信息（含角色，前端据此区分学生端 / 管理端） */
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    phone: u.phone,
    avatar: u.avatar,
    gender: u.gender,
    dorm: u.dorm,
    role: u.role || 'student',
    createTime: u.createTime
  }
}

/** 工单实体 -> 扁平对象（图片、进度日志拍平成字符串，与前端 convert.uts 保持一致） */
function orderToPlain(o) {
  const logs = (o.logs || []).map(function (l) { return l.time + '::' + l.content })
  return {
    id: o.id,
    orderNo: o.orderNo,
    userId: o.userId,
    userName: o.userName,
    category: o.category,
    building: o.building,
    room: o.room,
    contact: o.contact,
    description: o.description,
    images: joinStr(toArray(o.images), ','),
    level: o.level,
    status: o.status,
    createTime: o.createTime,
    updateTime: o.updateTime,
    remark: o.remark,
    logs: joinStr(logs, '|')
  }
}

/** 公告实体 -> 扁平对象 */
function noticeToPlain(n) {
  return { id: n.id, title: n.title, content: n.content, time: n.time, tag: n.tag }
}

/* -------------------------------- 演示数据 -------------------------------- */

/** 按状态生成工单进度日志 */
function buildLogs(status, hoursAgo) {
  const logs = []
  logs.push({ time: formatTime(Date.now() - hoursAgo * 3600000), content: '学生提交报修申请，等待宿管中心受理' })
  if (status === '1' || status === '2') {
    logs.push({ time: formatTime(Date.now() - Math.max(hoursAgo - 2, 0) * 3600000), content: '宿管中心已受理，维修师傅已接单' })
  }
  if (status === '2') {
    logs.push({ time: formatTime(Date.now() - 1 * 3600000), content: '维修完成，请同学确认并评价' })
  }
  if (status === '3') {
    logs.push({ time: formatTime(Date.now() - Math.max(hoursAgo - 1, 0) * 3600000), content: '学生主动取消该报修工单' })
  }
  return logs
}

function createSeedOrder(id, userId, userName, category, building, room, contact, description, level, status, hoursAgo) {
  return {
    id: id,
    orderNo: genOrderNo(),
    userId: userId,
    userName: userName,
    category: category,
    building: building,
    room: room,
    contact: contact,
    description: description,
    images: [],
    level: level,
    status: status,
    createTime: formatTime(Date.now() - hoursAgo * 3600000),
    updateTime: formatTime(Date.now() - Math.floor(hoursAgo / 2) * 3600000),
    remark: '',
    logs: buildLogs(status, hoursAgo)
  }
}

/** 写入演示数据（三张表为空时由 init() 自动调用，也可 node db.js --reset 手动重建） */
async function seed() {
  const admin = {
    id: 'u_1000', username: 'admin', password: '123456', nickname: '宿舍管理中心',
    phone: '13900000000', avatar: '', gender: '不限', dorm: '后勤保障部', role: 'admin',
    createTime: formatTime(Date.now() - 3600000 * 24 * 180)
  }
  const u1 = {
    id: 'u_1001', username: 'student', password: '123456', nickname: '林小同',
    phone: '13800138000', avatar: '', gender: '男', dorm: 'A栋-305', role: 'student',
    createTime: formatTime(Date.now() - 3600000 * 24 * 60)
  }
  const u2 = {
    id: 'u_1002', username: 'xiaoyu', password: '123456', nickname: '苏小雨',
    phone: '13612345678', avatar: '', gender: '女', dorm: 'B栋-512', role: 'student',
    createTime: formatTime(Date.now() - 3600000 * 24 * 20)
  }

  const notices = [
    {
      id: 'n_1', title: '关于学生宿舍冬季供暖设备集中检修的通知',
      content: '后勤保障部将于本周对学生公寓供暖设备进行集中检修，检修期间可能出现短暂停水停电，请同学们提前做好准备。如遇供暖异常，请及时通过本平台提交报修工单。',
      time: formatTime(Date.now() - 3600000 * 24 * 2), tag: '检修'
    },
    {
      id: 'n_2', title: '宿舍报修服务时效说明',
      content: '一般故障 24 小时内受理，紧急故障（漏水、漏电、门锁损坏）4 小时内受理。提交工单时请如实填写宿舍号与联系方式，并尽量上传现场照片，以便师傅快速定位问题。',
      time: formatTime(Date.now() - 3600000 * 24 * 5), tag: '服务'
    },
    {
      id: 'n_3', title: '寒假期间宿舍设施报修安排',
      content: '寒假留校同学如需报修，请在工单中备注「寒假留校」，值班维修点设在 3 号学生公寓一楼服务台，服务时间 8:30 - 17:30。',
      time: formatTime(Date.now() - 3600000 * 24 * 9), tag: '假期'
    }
  ]

  const orders = [
    createSeedOrder('o_2001', u1.id, u1.nickname, '水电维修', 'A栋', '305', u1.phone, '洗手间水龙头持续滴水，地面积水严重，存在滑倒风险。', '紧急', '0', 3),
    createSeedOrder('o_2002', u1.id, u1.nickname, '空调电器', 'A栋', '305', u1.phone, '宿舍空调制冷效果差，开机半小时后房间温度没有变化，怀疑缺氟。', '普通', '1', 28),
    createSeedOrder('o_2003', u1.id, u1.nickname, '门窗家具', 'A栋', '305', u1.phone, '衣柜门合页脱落，柜门无法正常关闭。', '普通', '2', 96),
    createSeedOrder('o_2004', u1.id, u1.nickname, '网络宽带', 'A栋', '305', u1.phone, '宿舍网口无法识别，路由器指示灯不亮。', '普通', '3', 140),
    createSeedOrder('o_2005', u2.id, u2.nickname, '公共设施', 'B栋', '512', u2.phone, '楼层公共洗衣机漏水，地面湿滑。', '普通', '0', 10),
    createSeedOrder('o_2006', u2.id, u2.nickname, '水电维修', 'B栋', '512', u2.phone, '宿舍照明灯管闪烁，晚上无法正常自习。', '紧急', '1', 50),
    createSeedOrder('o_2007', u2.id, u2.nickname, '其他问题', 'C栋', '208', '13712345678', '卫生间地漏返味严重，希望安排疏通。', '普通', '2', 180)
  ]

  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    for (const u of [admin, u1, u2]) {
      await conn.execute(
        'INSERT INTO t_user (id, username, password, nickname, phone, avatar, gender, dorm, role, create_time)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [u.id, u.username, u.password, u.nickname, u.phone, u.avatar, u.gender, u.dorm, u.role, u.createTime])
    }
    for (const n of notices) {
      await conn.execute(
        'INSERT INTO t_notice (id, title, content, time, tag) VALUES (?, ?, ?, ?, ?)',
        [n.id, n.title, n.content, n.time, n.tag])
    }
    for (const o of orders) {
      await conn.execute(
        'INSERT INTO t_repair_order (id, order_no, user_id, user_name, category, building, room, contact,' +
        ' description, images, level, status, create_time, update_time, remark, logs)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [o.id, o.orderNo, o.userId, o.userName, o.category, o.building, o.room, o.contact,
          o.description, joinStr(toArray(o.images), ','), o.level, o.status, o.createTime,
          o.updateTime, o.remark, JSON.stringify(o.logs)])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  console.log('[db] 已写入演示数据：用户 3 条，工单 7 条，公告 3 条')
}

/** 清空并重新写入演示数据 */
async function reset() {
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    // 先删子表再删父表，避免外键约束报错
    await conn.query('DELETE FROM t_repair_order')
    await conn.query('DELETE FROM t_user')
    await conn.query('DELETE FROM t_notice')
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  await seed()
  const c = await counts()
  console.log('[db] 已重置为演示数据：用户 ' + c.users + ' 条，工单 ' + c.orders + ' 条，公告 ' + c.notices + ' 条')
}

/* ------------------------------- 命令行入口 ------------------------------- */
/* node db.js --reset 可随时把数据库恢复成演示数据 */

if (require.main === module) {
  ;(async function () {
    try {
      await init()
      if (process.argv.indexOf('--reset') >= 0) {
        await reset()
      } else {
        const c = await counts()
        console.log('[db] 当前数据：用户 ' + c.users + ' 条，工单 ' + c.orders + ' 条，公告 ' + c.notices + ' 条')
        console.log('[db] 数据库：' + config.mysql.user + '@' + config.mysql.host + ':' +
          config.mysql.port + '/' + config.mysql.database)
      }
      await close()
      process.exit(0)
    } catch (e) {
      console.error('[db] 初始化失败：' + e.message)
      process.exit(1)
    }
  })()
}

module.exports = {
  // 常量
  DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
  DEFAULT_TIPS: DEFAULT_TIPS,
  // 生命周期
  init: init,
  close: close,
  seed: seed,
  reset: reset,
  getPool: getPool,
  // 工具
  pad2: pad2,
  formatTime: formatTime,
  nowTime: nowTime,
  isPhone: isPhone,
  genId: genId,
  genOrderNo: genOrderNo,
  joinStr: joinStr,
  splitStr: splitStr,
  toArray: toArray,
  // 用户
  getUser: getUser,
  getUserByAccount: getUserByAccount,
  getUserByUsername: getUserByUsername,
  getUserByPhone: getUserByPhone,
  listUsers: listUsers,
  addUser: addUser,
  updateUser: updateUser,
  removeUser: removeUser,
  countAdmins: countAdmins,
  // 工单
  getOrder: getOrder,
  listOrders: listOrders,
  addOrder: addOrder,
  updateOrder: updateOrder,
  removeOrder: removeOrder,
  countOrdersByStatus: countOrdersByStatus,
  // 公告
  listNotices: listNotices,
  getNotice: getNotice,
  addNotice: addNotice,
  updateNotice: updateNotice,
  removeNotice: removeNotice,
  // 统计
  counts: counts,
  adminStat: adminStat,
  // 序列化
  publicUser: publicUser,
  orderToPlain: orderToPlain,
  noticeToPlain: noticeToPlain,
  rowToUser: rowToUser,
  rowToOrder: rowToOrder,
  rowToNotice: rowToNotice
}
