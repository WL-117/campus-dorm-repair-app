'use strict'
/**
 * 后端业务路由层（Router / Controller）—— MySQL 版
 * ------------------------------------------------------------------
 * 完全遵循 RESTful 风格，接口与前端 common/api.uts、common/mock-server.uts 一一对应：
 *    POST   /user/register      用户注册（新增）
 *    POST   /user/login         用户登录
 *    GET    /user/info          查询用户信息
 *    PUT    /user/update        修改用户信息（修改）
 *    GET    /repair/list        工单列表（分页 + 状态筛选 + 关键字查询）
 *    GET    /repair/detail      工单详情
 *    POST   /repair/create      提交报修（新增）
 *    PUT    /repair/update      修改工单
 *    POST   /repair/cancel      取消报修
 *    DELETE /repair/delete      删除工单（删除）
 *    GET    /stat/mine          个人工单统计
 *    GET    /category/list      故障分类（常用数据）
 *    GET    /tips/list          常见故障提示
 *    GET    /notice/list        公告列表
 *    GET    /notice/detail      公告详情
 *    GET    /health             服务健康检查
 * 统一返回 ApiResult：{ code, message, data }，code = 0 表示业务成功
 *
 * 数据层（server/db.js）已切换为 MySQL，所有 handler 均为 async，
 * 分页 / 筛选 / 关键字 / 统计全部下推到 SQL 执行。
 */

const db = require('./db')

/* ------------------------------ 返回结果封装 ------------------------------ */

function ok(data) {
  return { code: 0, message: '操作成功', data: data }
}

function fail(message) {
  return { code: 1, message: message, data: '' }
}

/* -------------------------------- 参数工具 -------------------------------- */

function str(params, key) {
  const v = params[key]
  if (v === undefined || v === null) return ''
  return String(v)
}

function num(params, key, def) {
  const v = Number(params[key])
  if (isNaN(v) || v <= 0) return def === undefined ? 0 : def
  return v
}

/**
 * 解析当前操作用户
 * 优先取参数 userId；缺失时从登录凭证 token（tk_用户ID_时间戳）中还原，
 * 与前端 mock-server.uts 的 token 规则保持一致
 */
function resolveUserId(params, ctx) {
  const uid = str(params, 'userId')
  if (uid) return uid
  const token = str(params, 'token') || (ctx && ctx.token ? ctx.token : '')
  // 凭证格式：tk_用户ID_时间戳（用户ID 自身含下划线，故取最后一个下划线之前的部分）
  if (token.indexOf('tk_') === 0) {
    const idx = token.lastIndexOf('_')
    if (idx > 3) return token.substring(3, idx)
  }
  return ''
}

/** 取当前用户实体，未找到返回 null */
async function currentUser(params, ctx) {
  const uid = resolveUserId(params, ctx)
  if (!uid) return null
  return db.getUser(uid)
}

/**
 * 管理员权限校验
 * 通过返回用户实体，未登录或无权限返回 null（调用方直接返回 fail 提示）
 */
async function requireAdmin(params, ctx) {
  const user = await currentUser(params, ctx)
  if (!user) return null
  if (user.role !== 'admin') return null
  return user
}

/* --------------------------------- 用户模块 --------------------------------- */

/** POST /user/register 用户注册 */
async function handleRegister(params) {
  const username = str(params, 'username')
  const password = str(params, 'password')
  const nickname = str(params, 'nickname')
  const phone = str(params, 'phone')
  const gender = str(params, 'gender')
  const dorm = str(params, 'dorm')

  if (!db.isPhone(phone)) return fail('请输入正确的 11 位手机号')
  if (username.length < 4) return fail('账号长度不能少于 4 位')
  if (password.length < 6) return fail('密码长度不能少于 6 位')
  if (await db.getUserByUsername(username)) return fail('该账号已被注册，请直接登录')
  if (await db.getUserByPhone(phone)) return fail('该手机号已注册，请直接登录')

  const user = {
    id: db.genId('u_'),
    username: username,
    password: password,
    nickname: nickname.length > 0 ? nickname : '同学' + username,
    phone: phone,
    avatar: '',
    gender: gender,
    dorm: dorm,
    role: 'student', // 注册一律为学生，管理员账号由系统预置
    createTime: db.nowTime()
  }
  await db.addUser(user)
  return ok(db.publicUser(user))
}

/** POST /user/login 用户登录 */
async function handleLogin(params) {
  const username = str(params, 'username')
  const password = str(params, 'password')
  if (username.length === 0) return fail('请输入账号')
  if (password.length === 0) return fail('请输入密码')

  const user = await db.getUserByAccount(username)
  if (!user) return fail('账号不存在，请先注册')
  if (user.password !== password) return fail('账号或密码错误')

  return ok({
    token: 'tk_' + user.id + '_' + Date.now(),
    userInfo: db.publicUser(user)
  })
}

/** GET /user/info 查询用户信息 */
async function handleUserInfo(params, ctx) {
  const user = await currentUser(params, ctx)
  if (!user) return fail('登录状态已失效，请重新登录')
  return ok(db.publicUser(user))
}

/** PUT /user/update 修改用户信息 */
async function handleUserUpdate(params, ctx) {
  const user = await currentUser(params, ctx)
  if (!user) return fail('登录状态已失效，请重新登录')

  const nickname = str(params, 'nickname')
  const avatar = str(params, 'avatar')
  const gender = str(params, 'gender')
  const dorm = str(params, 'dorm')
  const phone = str(params, 'phone')

  const patch = {}
  if (nickname.length > 0) patch.nickname = nickname
  if (avatar.length > 0) patch.avatar = avatar
  if (gender.length > 0) patch.gender = gender
  if (dorm.length > 0) patch.dorm = dorm
  if (phone.length > 0) {
    if (!db.isPhone(phone)) return fail('请输入正确的 11 位手机号')
    patch.phone = phone
  }

  const updated = await db.updateUser(user.id, patch)
  return ok(db.publicUser(updated))
}

/* --------------------------------- 工单模块 --------------------------------- */

/** POST /repair/create 提交报修 */
async function handleRepairCreate(params, ctx) {
  const user = await currentUser(params, ctx)
  if (!user) return fail('请先登录后再提交报修')

  const category = str(params, 'category')
  const building = str(params, 'building')
  const room = str(params, 'room')
  const contact = str(params, 'contact')
  const description = str(params, 'description')
  const level = str(params, 'level')

  if (category.length === 0) return fail('请选择故障分类')
  if (building.length === 0) return fail('请输入宿舍楼栋')
  if (room.length === 0) return fail('请输入宿舍号')
  if (!db.isPhone(contact)) return fail('请输入正确的 11 位手机号')
  if (description.length < 5) return fail('故障描述不少于 5 个字，便于师傅定位')

  const now = db.nowTime()
  const order = {
    id: db.genId('o_'),
    orderNo: db.genOrderNo(),
    userId: user.id,
    userName: user.nickname,
    category: category,
    building: building,
    room: room,
    contact: contact,
    description: description,
    images: db.toArray(params.images),
    level: level.length > 0 ? level : '普通',
    status: '0',
    createTime: now,
    updateTime: now,
    remark: '',
    logs: [{ time: now, content: '学生提交报修申请，等待宿管中心受理' }]
  }
  await db.addOrder(order)
  return ok(db.orderToPlain(order))
}

/** GET /repair/list 工单列表（分页 + 状态筛选 + 关键字查询） */
async function handleRepairList(params, ctx) {
  const page = num(params, 'page', 1)
  const size = num(params, 'size', 10)
  const status = str(params, 'status')
  const keyword = str(params, 'keyword')
  const scope = str(params, 'scope')
  const userId = resolveUserId(params, ctx)

  const result = await db.listOrders({
    userId: scope === 'mine' ? userId : '',
    status: status,
    keyword: keyword,
    page: page,
    size: size,
    admin: false
  })

  const list = result.rows.map(db.orderToPlain)
  const start = (page - 1) * size
  return ok({
    list: list,
    total: result.total,
    page: page,
    size: size,
    hasMore: start + list.length < result.total
  })
}

/** GET /repair/detail 工单详情 */
async function handleRepairDetail(params) {
  const order = await db.getOrder(str(params, 'id'))
  if (!order) return fail('工单不存在或已被删除')
  return ok(db.orderToPlain(order))
}

/** PUT /repair/update 修改工单 */
async function handleRepairUpdate(params) {
  const order = await db.getOrder(str(params, 'id'))
  if (!order) return fail('工单不存在或已被删除')

  const description = str(params, 'description')
  const room = str(params, 'room')
  const contact = str(params, 'contact')

  const patch = { updateTime: db.nowTime() }
  if (description.length > 0) patch.description = description
  if (room.length > 0) patch.room = room
  if (contact.length > 0) {
    if (!db.isPhone(contact)) return fail('请输入正确的 11 位手机号')
    patch.contact = contact
  }

  const updated = await db.updateOrder(order.id, patch, null)
  return ok(db.orderToPlain(updated))
}

/** POST /repair/cancel 取消报修 */
async function handleRepairCancel(params, ctx) {
  const order = await db.getOrder(str(params, 'id'))
  if (!order) return fail('工单不存在或已被删除')
  if (order.userId !== resolveUserId(params, ctx)) return fail('只能取消本人提交的工单')
  if (order.status !== '0') return fail('只有「待处理」状态的工单可以取消')

  const now = db.nowTime()
  const updated = await db.updateOrder(order.id, { status: '3', updateTime: now },
    { time: now, content: '学生主动取消该报修工单' })
  return ok(db.orderToPlain(updated))
}

/** DELETE /repair/delete 删除工单 */
async function handleRepairDelete(params, ctx) {
  const id = str(params, 'id')
  const order = await db.getOrder(id)
  if (!order) return fail('工单不存在或已被删除')
  if (order.userId !== resolveUserId(params, ctx)) return fail('只能删除本人提交的工单')

  await db.removeOrder(id)
  return ok({ id: id })
}

/** GET /stat/mine 个人工单统计 */
async function handleStat(params, ctx) {
  const userId = resolveUserId(params, ctx)
  const stat = await db.countOrdersByStatus(userId)
  return ok(stat)
}

/* ------------------------------- 常用数据模块 ------------------------------- */

/** GET /category/list 故障分类 */
async function handleCategoryList() {
  return ok({
    list: db.DEFAULT_CATEGORIES.map(function (name) { return { name: name } })
  })
}

/** GET /tips/list 常见故障提示 */
async function handleTipsList() {
  return ok({ list: db.DEFAULT_TIPS.slice() })
}

/** GET /notice/list 公告列表 */
async function handleNoticeList() {
  const notices = await db.listNotices()
  return ok({
    list: notices.map(db.noticeToPlain)
  })
}

/** GET /notice/detail 公告详情 */
async function handleNoticeDetail(params) {
  const notice = await db.getNotice(str(params, 'id'))
  if (!notice) return fail('公告不存在')
  return ok(db.noticeToPlain(notice))
}

/** GET /health 健康检查（联调时用浏览器直接访问即可） */
async function handleHealth() {
  const c = await db.counts()
  return ok({
    service: 'dorm-repair-server',
    time: db.nowTime(),
    users: c.users,
    orders: c.orders,
    notices: c.notices
  })
}

/* --------------------------------- 管理端模块 --------------------------------- */

/** GET /admin/stat 平台总览统计 */
async function handleAdminStat(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')
  return ok(await db.adminStat())
}

/** GET /admin/user/list 用户列表（分页 + 关键字：昵称 / 账号 / 手机号 / 宿舍） */
async function handleAdminUserList(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')

  const page = num(params, 'page', 1)
  const size = num(params, 'size', 10)
  const role = str(params, 'role')
  const keyword = str(params, 'keyword')

  const result = await db.listUsers({ role: role, keyword: keyword, page: page, size: size })
  const start = (page - 1) * size
  const list = result.rows.map(function (row) {
    const info = db.publicUser(db.rowToUser(row))
    // 附带该用户的工单数量（由 SQL 子查询统计），方便管理端展示
    info.orderCount = Number(row.order_count || 0)
    return info
  })
  return ok({
    list: list,
    total: result.total,
    page: page,
    size: size,
    hasMore: start + list.length < result.total
  })
}

/** DELETE /admin/user/delete 删除用户（级联删除其工单，保留最后一个管理员） */
async function handleAdminUserDelete(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')

  const id = str(params, 'id')
  if (id === admin.id) return fail('不能删除当前登录的管理员账号')
  const user = await db.getUser(id)
  if (!user) return fail('用户不存在或已被删除')
  if (user.role === 'admin' && (await db.countAdmins()) <= 1) return fail('系统至少需要保留一个管理员账号')

  await db.removeUser(id)
  return ok({ id: id })
}

/** GET /admin/order/list 工单管理列表（分页 + 状态筛选 + 关键字） */
async function handleAdminOrderList(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')

  const page = num(params, 'page', 1)
  const size = num(params, 'size', 10)
  const status = str(params, 'status')
  const keyword = str(params, 'keyword')

  const result = await db.listOrders({
    userId: '',
    status: status,
    keyword: keyword,
    page: page,
    size: size,
    admin: true
  })
  const list = result.rows.map(db.orderToPlain)
  const start = (page - 1) * size
  return ok({
    list: list,
    total: result.total,
    page: page,
    size: size,
    hasMore: start + list.length < result.total
  })
}

/** PUT /admin/order/status 推进工单状态（0待处理 -> 1维修中 -> 2已完成） */
async function handleAdminOrderStatus(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')

  const order = await db.getOrder(str(params, 'id'))
  if (!order) return fail('工单不存在或已被删除')

  const status = str(params, 'status')
  if (status !== '1' && status !== '2') return fail('只能将工单推进为「维修中」或「已完成」')
  if (order.status === '2') return fail('该工单已完成，无需再次处理')
  if (order.status === '3') return fail('该工单已取消，无法继续处理')
  if (status === '1' && order.status !== '0') return fail('该工单已在维修中')
  if (status === '2' && order.status !== '1') return fail('请先将工单置为「维修中」')

  const now = db.nowTime()
  const log = status === '1'
    ? { time: now, content: '宿管中心已受理，维修师傅已接单（处理人：' + admin.nickname + '）' }
    : { time: now, content: '维修完成，请同学确认（处理人：' + admin.nickname + '）' }
  const updated = await db.updateOrder(order.id, { status: status, updateTime: now }, log)
  return ok(db.orderToPlain(updated))
}

/** PUT /admin/order/remark 管理员填写处理备注 */
async function handleAdminOrderRemark(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')

  const order = await db.getOrder(str(params, 'id'))
  if (!order) return fail('工单不存在或已被删除')

  const remark = str(params, 'remark')
  if (remark.length === 0) return fail('请填写处理备注')

  const now = db.nowTime()
  const updated = await db.updateOrder(order.id, { remark: remark, updateTime: now },
    { time: now, content: '管理员备注：' + remark + '（' + admin.nickname + '）' })
  return ok(db.orderToPlain(updated))
}

/** POST /admin/notice/create 发布公告 */
async function handleAdminNoticeCreate(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')

  const title = str(params, 'title')
  const content = str(params, 'content')
  const tag = str(params, 'tag')
  if (title.length === 0) return fail('请输入公告标题')
  if (content.length < 5) return fail('公告内容不少于 5 个字')

  const notice = {
    id: db.genId('n_'),
    title: title,
    content: content,
    time: db.nowTime(),
    tag: tag.length > 0 ? tag : '通知'
  }
  await db.addNotice(notice)
  return ok(db.noticeToPlain(notice))
}

/** PUT /admin/notice/update 修改公告 */
async function handleAdminNoticeUpdate(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')

  const id = str(params, 'id')
  // 只更新本次传过来的字段，避免空值覆盖
  const patch = {}
  if (params.title !== undefined) patch.title = str(params, 'title')
  if (params.content !== undefined) patch.content = str(params, 'content')
  if (params.tag !== undefined) patch.tag = str(params, 'tag')
  const notice = await db.updateNotice(id, patch)
  if (!notice) return fail('公告不存在')
  return ok(db.noticeToPlain(notice))
}

/** DELETE /admin/notice/delete 删除公告 */
async function handleAdminNoticeDelete(params, ctx) {
  const admin = await requireAdmin(params, ctx)
  if (!admin) return fail('无管理员权限，请使用管理员账号登录')

  const id = str(params, 'id')
  if (!(await db.getNotice(id))) return fail('公告不存在')
  await db.removeNotice(id)
  return ok({ id: id })
}

/* --------------------------------- 路由分发 --------------------------------- */

const ROUTES = [
  { method: 'GET', path: '/health', handler: handleHealth },

  { method: 'POST', path: '/user/register', handler: handleRegister },
  { method: 'POST', path: '/user/login', handler: handleLogin },
  { method: 'GET', path: '/user/info', handler: handleUserInfo },
  { method: 'PUT', path: '/user/update', handler: handleUserUpdate },

  { method: 'POST', path: '/repair/create', handler: handleRepairCreate },
  { method: 'GET', path: '/repair/list', handler: handleRepairList },
  { method: 'GET', path: '/repair/detail', handler: handleRepairDetail },
  { method: 'PUT', path: '/repair/update', handler: handleRepairUpdate },
  { method: 'POST', path: '/repair/cancel', handler: handleRepairCancel },
  { method: 'DELETE', path: '/repair/delete', handler: handleRepairDelete },
  { method: 'GET', path: '/stat/mine', handler: handleStat },

  { method: 'GET', path: '/category/list', handler: handleCategoryList },
  { method: 'GET', path: '/tips/list', handler: handleTipsList },
  { method: 'GET', path: '/notice/list', handler: handleNoticeList },
  { method: 'GET', path: '/notice/detail', handler: handleNoticeDetail },

  { method: 'GET', path: '/admin/stat', handler: handleAdminStat },
  { method: 'GET', path: '/admin/user/list', handler: handleAdminUserList },
  { method: 'DELETE', path: '/admin/user/delete', handler: handleAdminUserDelete },
  { method: 'GET', path: '/admin/order/list', handler: handleAdminOrderList },
  { method: 'PUT', path: '/admin/order/status', handler: handleAdminOrderStatus },
  { method: 'PUT', path: '/admin/order/remark', handler: handleAdminOrderRemark },
  { method: 'POST', path: '/admin/notice/create', handler: handleAdminNoticeCreate },
  { method: 'PUT', path: '/admin/notice/update', handler: handleAdminNoticeUpdate },
  { method: 'DELETE', path: '/admin/notice/delete', handler: handleAdminNoticeDelete }
]

/**
 * 路由分发入口
 * @param {string} method  HTTP 方法：GET / POST / PUT / DELETE
 * @param {string} url     接口路径，如 /repair/list
 * @param {object} params  合并后的参数（query + body）
 * @param {object} ctx     请求上下文：{ token }
 * @returns {Promise<{code:number, message:string, data:*}>}
 */
async function handle(method, url, params, ctx) {
  const path = String(url || '/').split('?')[0]
  for (let i = 0; i < ROUTES.length; i++) {
    const route = ROUTES[i]
    if (route.path === path && route.method === method) {
      return route.handler(params || {}, ctx || {})
    }
  }
  return fail('接口不存在：' + method + ' ' + path)
}

module.exports = {
  handle: handle,
  ROUTES: ROUTES,
  ok: ok,
  fail: fail
}
