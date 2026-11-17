'use strict'
/**
 * 后端数据层（Database / DAO）
 * ------------------------------------------------------------------
 * 1. 三张表与前端模拟后端（common/mock-server.uts）完全对齐：
 *      t_user         用户表
 *      t_repair_order 报修工单表
 *      t_notice       公告表
 * 2. 文件持久化：数据以 JSON 形式落盘到 server/data/db.json，服务重启不丢失
 * 3. 首次启动（或数据表为空）自动写入演示数据（seed）
 * 4. 路由层只调用本文件暴露的「查询 / 变更」方法，不直接读写文件，
 *    每一次变更都会立即落盘，保证数据一致性
 */

const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')

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

/* ------------------------------ 数据库（内存） ------------------------------ */

/** @type {{users:Array, orders:Array, notices:Array}} */
let db = { users: [], orders: [], notices: [] }

/* -------------------------------- 持久化 ---------------------------------- */

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

/** 从磁盘加载；文件不存在或损坏时自动重建演示数据 */
function load() {
  ensureDataDir()
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
      db = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        notices: Array.isArray(parsed.notices) ? parsed.notices : []
      }
    } else {
      seed()
      return
    }
  } catch (e) {
    console.error('[db] 数据文件读取失败，已自动重建：' + e.message)
    seed()
    return
  }
  // 三张表都为空视为首次运行
  if (db.users.length === 0 && db.orders.length === 0 && db.notices.length === 0) seed()
}

/** 落盘（先写临时文件再改名，避免写入中断导致文件损坏） */
function save() {
  ensureDataDir()
  const tmp = DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  fs.renameSync(tmp, DB_FILE)
}

/** 清空并重新写入演示数据 */
function reset() {
  seed()
  console.log('[db] 已重置为演示数据：用户 ' + db.users.length + ' 条，工单 ' + db.orders.length + ' 条，公告 ' + db.notices.length + ' 条')
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

function seed() {
  // 管理员账号：宿舍管理中心（role = admin）
  const admin = {
    id: 'u_1000',
    username: 'admin',
    password: '123456',
    nickname: '宿舍管理中心',
    phone: '13900000000',
    avatar: '',
    gender: '不限',
    dorm: '后勤保障部',
    role: 'admin',
    createTime: formatTime(Date.now() - 3600000 * 24 * 180)
  }
  const u1 = {
    id: 'u_1001',
    username: 'student',
    password: '123456',
    nickname: '林小同',
    phone: '13800138000',
    avatar: '',
    gender: '男',
    dorm: 'A栋-305',
    role: 'student',
    createTime: formatTime(Date.now() - 3600000 * 24 * 60)
  }
  const u2 = {
    id: 'u_1002',
    username: 'xiaoyu',
    password: '123456',
    nickname: '苏小雨',
    phone: '13612345678',
    avatar: '',
    gender: '女',
    dorm: 'B栋-512',
    role: 'student',
    createTime: formatTime(Date.now() - 3600000 * 24 * 20)
  }
  db.users = [admin, u1, u2]

  db.notices = [
    {
      id: 'n_1',
      title: '关于学生宿舍冬季供暖设备集中检修的通知',
      content: '后勤保障部将于本周对学生公寓供暖设备进行集中检修，检修期间可能出现短暂停水停电，请同学们提前做好准备。如遇供暖异常，请及时通过本平台提交报修工单。',
      time: formatTime(Date.now() - 3600000 * 24 * 2),
      tag: '检修'
    },
    {
      id: 'n_2',
      title: '宿舍报修服务时效说明',
      content: '一般故障 24 小时内受理，紧急故障（漏水、漏电、门锁损坏）4 小时内受理。提交工单时请如实填写宿舍号与联系方式，并尽量上传现场照片，以便师傅快速定位问题。',
      time: formatTime(Date.now() - 3600000 * 24 * 5),
      tag: '服务'
    },
    {
      id: 'n_3',
      title: '寒假期间宿舍设施报修安排',
      content: '寒假留校同学如需报修，请在工单中备注「寒假留校」，值班维修点设在 3 号学生公寓一楼服务台，服务时间 8:30 - 17:30。',
      time: formatTime(Date.now() - 3600000 * 24 * 9),
      tag: '假期'
    }
  ]

  db.orders = [
    createSeedOrder('o_2001', u1.id, u1.nickname, '水电维修', 'A栋', '305', u1.phone, '洗手间水龙头持续滴水，地面积水严重，存在滑倒风险。', '紧急', '0', 3),
    createSeedOrder('o_2002', u1.id, u1.nickname, '空调电器', 'A栋', '305', u1.phone, '宿舍空调制冷效果差，开机半小时后房间温度没有变化，怀疑缺氟。', '普通', '1', 28),
    createSeedOrder('o_2003', u1.id, u1.nickname, '门窗家具', 'A栋', '305', u1.phone, '衣柜门合页脱落，柜门无法正常关闭。', '普通', '2', 96),
    createSeedOrder('o_2004', u1.id, u1.nickname, '网络宽带', 'A栋', '305', u1.phone, '宿舍网口无法识别，路由器指示灯不亮。', '普通', '3', 140),
    createSeedOrder('o_2005', u2.id, u2.nickname, '公共设施', 'B栋', '512', u2.phone, '楼层公共洗衣机漏水，地面湿滑。', '普通', '0', 10),
    createSeedOrder('o_2006', u2.id, u2.nickname, '水电维修', 'B栋', '512', u2.phone, '宿舍照明灯管闪烁，晚上无法正常自习。', '紧急', '1', 50),
    createSeedOrder('o_2007', u2.id, u2.nickname, '其他问题', 'C栋', '208', '13712345678', '卫生间地漏返味严重，希望安排疏通。', '普通', '2', 180)
  ]

  save()
}

/* -------------------------------- 查询方法 -------------------------------- */

function allUsers() { return db.users }
function allOrders() { return db.orders }
function allNotices() { return db.notices }

function findUser(id) {
  for (let i = 0; i < db.users.length; i++) {
    if (db.users[i].id === id) return db.users[i]
  }
  return null
}

/** 账号或手机号登录 */
function findUserByAccount(account) {
  for (let i = 0; i < db.users.length; i++) {
    if (db.users[i].username === account || db.users[i].phone === account) return db.users[i]
  }
  return null
}

function findUserByUsername(username) {
  for (let i = 0; i < db.users.length; i++) {
    if (db.users[i].username === username) return db.users[i]
  }
  return null
}

function findUserByPhone(phone) {
  for (let i = 0; i < db.users.length; i++) {
    if (db.users[i].phone === phone) return db.users[i]
  }
  return null
}

function findOrder(id) {
  for (let i = 0; i < db.orders.length; i++) {
    if (db.orders[i].id === id) return db.orders[i]
  }
  return null
}

function findNotice(id) {
  for (let i = 0; i < db.notices.length; i++) {
    if (db.notices[i].id === id) return db.notices[i]
  }
  return null
}

/* -------------------------------- 变更方法 -------------------------------- */

function addUser(user) {
  db.users.push(user)
  save()
  return user
}

function addOrder(order) {
  // 新工单置顶，列表按时间倒序
  db.orders.unshift(order)
  save()
  return order
}

function removeOrder(id) {
  db.orders = db.orders.filter(function (o) { return o.id !== id })
  save()
}

function saveUsers() { save() }
function saveOrders() { save() }
function saveNotices() { save() }

/* --------------------------- 管理员专用变更方法 --------------------------- */

/** 发布公告 */
function addNotice(notice) {
  db.notices.unshift(notice)
  save()
  return notice
}

/** 修改公告 */
function updateNotice(id, patch) {
  const notice = findNotice(id)
  if (!notice) return null
  if (patch.title !== undefined) notice.title = patch.title
  if (patch.content !== undefined) notice.content = patch.content
  if (patch.tag !== undefined) notice.tag = patch.tag
  save()
  return notice
}

/** 删除公告 */
function removeNotice(id) {
  db.notices = db.notices.filter(function (n) { return n.id !== id })
  save()
}

/** 删除用户（同时删除其名下工单，保持数据一致性） */
function removeUser(id) {
  db.users = db.users.filter(function (u) { return u.id !== id })
  db.orders = db.orders.filter(function (o) { return o.userId !== id })
  save()
}

/** 管理员数量（用于保护最后一个管理员账号） */
function countAdmin() {
  let n = 0
  for (let i = 0; i < db.users.length; i++) {
    if (db.users[i].role === 'admin') n++
  }
  return n
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

/* ------------------------------- 命令行入口 ------------------------------- */
/* node db.js --reset 可随时把数据库恢复成演示数据 */
if (require.main === module) {
  load()
  if (process.argv.indexOf('--reset') >= 0) {
    reset()
  } else {
    console.log('[db] 当前数据：用户 ' + db.users.length + ' 条，工单 ' + db.orders.length + ' 条，公告 ' + db.notices.length + ' 条')
    console.log('[db] 数据文件：' + DB_FILE)
  }
}

module.exports = {
  // 常量
  DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
  DEFAULT_TIPS: DEFAULT_TIPS,
  // 生命周期
  load: load,
  save: save,
  seed: seed,
  reset: reset,
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
  // 查询
  allUsers: allUsers,
  allOrders: allOrders,
  allNotices: allNotices,
  findUser: findUser,
  findUserByAccount: findUserByAccount,
  findUserByUsername: findUserByUsername,
  findUserByPhone: findUserByPhone,
  findOrder: findOrder,
  findNotice: findNotice,
  // 变更
  addUser: addUser,
  addOrder: addOrder,
  removeOrder: removeOrder,
  addNotice: addNotice,
  updateNotice: updateNotice,
  removeNotice: removeNotice,
  removeUser: removeUser,
  countAdmin: countAdmin,
  saveUsers: saveUsers,
  saveOrders: saveOrders,
  saveNotices: saveNotices,
  // 序列化
  publicUser: publicUser,
  orderToPlain: orderToPlain,
  noticeToPlain: noticeToPlain
}
