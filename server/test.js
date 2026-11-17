'use strict'
/**
 * 后端接口自测脚本（零依赖）
 * ------------------------------------------------------------------
 * 用法：
 *   1. 先启动后端： node server.js
 *   2. 另开终端：   node test.js
 *                   node test.js http://192.168.1.100:3000/api   （指定地址）
 * 脚本会按顺序调用全部接口，逐个校验 code 与关键字段，最后输出统计结果
 */

const http = require('http')

const BASE = process.argv[2] || 'http://127.0.0.1:3000/api'

let passed = 0
let failed = 0

/** 发起一次接口调用；传入 token 时改为请求头鉴权 */
function call(method, path, params, token) {
  return new Promise(function (resolve, reject) {
    const isJson = /^https?:\/\//.test(BASE)
    if (!isJson) return reject(new Error('BASE 地址格式不正确'))
    const base = new URL(BASE)
    let url = base.origin + base.pathname.replace(/\/$/, '') + path
    let body = null

    if (method === 'GET') {
      const query = Object.keys(params || {})
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]) })
        .join('&')
      if (query) url += '?' + query
    } else {
      body = JSON.stringify(params || {})
    }

    const headers = body
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      : {}
    if (token) headers['token'] = token
    const req = http.request(url, {
      method: method,
      headers: headers
    }, function (res) {
      let raw = ''
      res.on('data', function (c) { raw += c })
      res.on('end', function () {
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(new Error('响应不是合法 JSON：' + raw.slice(0, 200)))
        }
      })
    })
    req.on('error', function (e) {
      reject(new Error('无法连接后端服务（' + BASE + '）：' + e.message + '，请先执行 node server.js'))
    })
    if (body) req.write(body)
    req.end()
  })
}

/** 断言并打印结果 */
function check(name, condition, detail) {
  if (condition) {
    passed++
    console.log('  [PASS] ' + name)
  } else {
    failed++
    console.log('  [FAIL] ' + name + (detail ? '  ->  ' + detail : ''))
  }
}

function randomPhone() {
  return '1' + [3, 4, 5, 6, 7, 8, 9][Math.floor(Math.random() * 7)] +
    String(Math.floor(Math.random() * 1e9)).padStart(9, '0').slice(0, 9)
}

async function main() {
  console.log('')
  console.log('  后端接口自测：' + BASE)
  console.log('  ------------------------------------------------------------')

  /* 1. 健康检查 */
  let res = await call('GET', '/health', {})
  check('GET /health 服务可用', res.code === 0, JSON.stringify(res))

  /* 2. 注册 */
  const username = 't' + Date.now().toString().slice(-8)
  const phone = randomPhone()
  res = await call('POST', '/user/register', {
    username: username, password: '123456', nickname: '测试同学', phone: phone, gender: '男', dorm: 'A栋-101'
  })
  check('POST /user/register 注册成功', res.code === 0 && res.data && res.data.id, JSON.stringify(res))
  const userId = res.code === 0 ? res.data.id : ''

  /* 3. 重复注册应被拦截 */
  res = await call('POST', '/user/register', {
    username: username, password: '123456', nickname: '测试同学', phone: phone, gender: '男', dorm: 'A栋-101'
  })
  check('POST /user/register 重复账号被拦截', res.code !== 0, JSON.stringify(res))

  /* 4. 手机号格式校验 */
  res = await call('POST', '/user/register', { username: 'x' + Date.now(), password: '123456', phone: '123' })
  check('POST /user/register 手机号校验', res.code !== 0, JSON.stringify(res))

  /* 5. 登录 */
  res = await call('POST', '/user/login', { username: username, password: '123456' })
  check('POST /user/login 登录成功', res.code === 0 && res.data && res.data.token, JSON.stringify(res))
  const token = res.code === 0 ? res.data.token : ''

  /* 6. 错误密码 */
  res = await call('POST', '/user/login', { username: username, password: '000000' })
  check('POST /user/login 密码错误被拦截', res.code !== 0, JSON.stringify(res))

  /* 7. 演示账号登录 */
  res = await call('POST', '/user/login', { username: 'student', password: '123456' })
  check('POST /user/login 演示账号 student/123456', res.code === 0, JSON.stringify(res))

  /* 8. 查询用户信息 */
  res = await call('GET', '/user/info', { userId: userId, token: token })
  check('GET /user/info 查询用户信息', res.code === 0 && res.data.nickname === '测试同学', JSON.stringify(res))

  /* 9. 修改用户信息 */
  res = await call('PUT', '/user/update', { userId: userId, token: token, nickname: '测试同学2', dorm: 'A栋-102' })
  check('PUT /user/update 修改用户信息', res.code === 0 && res.data.dorm === 'A栋-102', JSON.stringify(res))

  /* 10. 常用数据 */
  res = await call('GET', '/category/list', {})
  check('GET /category/list 故障分类', res.code === 0 && res.data.list.length === 6, JSON.stringify(res))
  res = await call('GET', '/tips/list', {})
  check('GET /tips/list 常见故障提示', res.code === 0 && res.data.list.length === 5, JSON.stringify(res))
  res = await call('GET', '/notice/list', {})
  check('GET /notice/list 公告列表', res.code === 0 && res.data.list.length === 3, JSON.stringify(res))
  res = await call('GET', '/notice/detail', { id: 'n_1' })
  check('GET /notice/detail 公告详情', res.code === 0 && res.data.id === 'n_1', JSON.stringify(res))

  /* 11. 提交报修 */
  res = await call('POST', '/repair/create', {
    userId: userId,
    token: token,
    category: '水电维修',
    building: 'A栋',
    room: '101',
    contact: phone,
    description: '测试工单：洗手间水龙头漏水，需要处理。',
    images: [],
    level: '紧急'
  })
  check('POST /repair/create 提交报修', res.code === 0 && res.data.status === '0', JSON.stringify(res))
  const orderId = res.code === 0 ? res.data.id : ''

  /* 12. 表单校验：描述过短 */
  res = await call('POST', '/repair/create', {
    userId: userId, category: '水电维修', building: 'A栋', room: '101', contact: phone, description: '短'
  })
  check('POST /repair/create 描述长度校验', res.code !== 0, JSON.stringify(res))

  /* 13. 工单列表（个人 / 全部 / 状态筛选 / 关键字） */
  res = await call('GET', '/repair/list', { userId: userId, scope: 'mine', page: 1, size: 10 })
  check('GET /repair/list 我的工单', res.code === 0 && res.data.total >= 1, JSON.stringify(res))
  res = await call('GET', '/repair/list', { page: 1, size: 5 })
  check('GET /repair/list 分页查询', res.code === 0 && res.data.list.length <= 5, JSON.stringify(res))
  res = await call('GET', '/repair/list', { page: 1, size: 10, status: '0' })
  check('GET /repair/list 状态筛选', res.code === 0 && res.data.list.every(function (o) { return o.status === '0' }), JSON.stringify(res))
  res = await call('GET', '/repair/list', { page: 1, size: 10, keyword: '空调' })
  check('GET /repair/list 关键字查询', res.code === 0, JSON.stringify(res))

  /* 14. 工单详情 */
  res = await call('GET', '/repair/detail', { id: orderId })
  check('GET /repair/detail 工单详情', res.code === 0 && res.data.id === orderId, JSON.stringify(res))

  /* 15. 修改工单 */
  res = await call('PUT', '/repair/update', { id: orderId, description: '测试工单：已重新描述故障现象。', room: '102', contact: phone })
  check('PUT /repair/update 修改工单', res.code === 0 && res.data.room === '102', JSON.stringify(res))

  /* 16. 个人统计 */
  res = await call('GET', '/stat/mine', { userId: userId })
  check('GET /stat/mine 个人工单统计', res.code === 0 && res.data.total >= 1, JSON.stringify(res))

  /* 17. 取消报修 */
  res = await call('POST', '/repair/cancel', { id: orderId, userId: userId })
  check('POST /repair/cancel 取消报修', res.code === 0 && res.data.status === '3', JSON.stringify(res))

  /* 18. 已取消工单不可重复取消 */
  res = await call('POST', '/repair/cancel', { id: orderId, userId: userId })
  check('POST /repair/cancel 状态校验', res.code !== 0, JSON.stringify(res))

  /* 19. 删除工单 */
  res = await call('DELETE', '/repair/delete', { id: orderId, userId: userId })
  check('DELETE /repair/delete 删除工单', res.code === 0, JSON.stringify(res))
  res = await call('GET', '/repair/detail', { id: orderId })
  check('DELETE /repair/delete 删除后不可查询', res.code !== 0, JSON.stringify(res))

  /* 20. 未登录用户提交报修被拦截 */
  res = await call('POST', '/repair/create', { category: '水电维修', building: 'A栋', room: '101', contact: phone, description: '未登录提交测试。' })
  check('POST /repair/create 未登录被拦截', res.code !== 0, JSON.stringify(res))

  /* 21. 管理员登录与权限 */
  res = await call('POST', '/user/login', { username: 'admin', password: '123456' })
  check('POST /user/login 管理员 admin/123456', res.code === 0 && res.data.userInfo.role === 'admin', JSON.stringify(res))
  const adminId = res.code === 0 ? res.data.userInfo.id : ''

  res = await call('GET', '/admin/stat', { userId: adminId })
  check('GET /admin/stat 管理员可见总览统计', res.code === 0 && res.data.orders > 0, JSON.stringify(res))

  res = await call('GET', '/admin/stat', { userId: userId })
  check('GET /admin/stat 学生无管理员权限', res.code !== 0, JSON.stringify(res))

  res = await call('GET', '/admin/user/list', { userId: adminId, page: 1, size: 10 })
  check('GET /admin/user/list 用户列表', res.code === 0 && res.data.total >= 3, JSON.stringify(res))

  res = await call('GET', '/admin/order/list', { userId: adminId, page: 1, size: 10 })
  check('GET /admin/order/list 工单管理列表', res.code === 0 && res.data.total >= 7, JSON.stringify(res))

  /* 22. 工单状态流转 */
  res = await call('POST', '/repair/create', {
    userId: userId, category: '门窗家具', building: 'A栋', room: '101',
    contact: phone, description: '管理员联调测试工单，衣柜门合页损坏。'
  })
  const adminOrderId = res.code === 0 ? res.data.id : ''
  check('POST /repair/create 学生提交待处理工单', res.code === 0, JSON.stringify(res))

  res = await call('PUT', '/admin/order/status', { userId: adminId, id: adminOrderId, status: '2' })
  check('PUT /admin/order/status 跨状态被拦截', res.code !== 0, JSON.stringify(res))

  res = await call('PUT', '/admin/order/status', { userId: adminId, id: adminOrderId, status: '1' })
  check('PUT /admin/order/status 受理为维修中', res.code === 0 && res.data.status === '1', JSON.stringify(res))

  res = await call('PUT', '/admin/order/status', { userId: adminId, id: adminOrderId, status: '2' })
  check('PUT /admin/order/status 置为已完成', res.code === 0 && res.data.status === '2', JSON.stringify(res))

  res = await call('PUT', '/admin/order/remark', { userId: adminId, id: adminOrderId, remark: '已更换合页，现场已清理' })
  check('PUT /admin/order/remark 填写处理备注', res.code === 0 && res.data.remark.length > 0, JSON.stringify(res))

  res = await call('GET', '/repair/detail', { id: adminOrderId })
  check('GET /repair/detail 学生可见处理进度', res.code === 0 && res.data.logs.indexOf('管理员备注') > 0, JSON.stringify(res))

  res = await call('DELETE', '/repair/delete', { id: adminOrderId, userId: userId })
  check('DELETE /repair/delete 清理测试工单', res.code === 0, JSON.stringify(res))

  /* 23. 公告管理 */
  res = await call('POST', '/admin/notice/create', {
    userId: adminId, title: '联调测试公告', content: '这是一条由自测脚本创建的公告内容。', tag: '测试'
  })
  const adminNoticeId = res.code === 0 ? res.data.id : ''
  check('POST /admin/notice/create 发布公告', res.code === 0, JSON.stringify(res))

  res = await call('GET', '/notice/detail', { id: adminNoticeId })
  check('GET /notice/detail 新公告可查询', res.code === 0, JSON.stringify(res))

  res = await call('DELETE', '/admin/notice/delete', { userId: adminId, id: adminNoticeId })
  check('DELETE /admin/notice/delete 删除公告', res.code === 0, JSON.stringify(res))

  res = await call('GET', '/notice/detail', { id: adminNoticeId })
  check('DELETE /admin/notice/delete 删除后不可查询', res.code !== 0, JSON.stringify(res))

  /* 24. 用户管理：清理自测账号 */
  res = await call('DELETE', '/admin/user/delete', { userId: adminId, id: userId })
  check('DELETE /admin/user/delete 删除用户', res.code === 0, JSON.stringify(res))

  res = await call('DELETE', '/admin/user/delete', { userId: adminId, id: adminId })
  check('DELETE /admin/user/delete 不能删除自己', res.code !== 0, JSON.stringify(res))

  /* 25. 仅凭 token 请求头调用管理端接口（不带 userId 参数） */
  const adminToken = (await call('POST', '/user/login', { username: 'admin', password: '123456' })).data.token
  res = await call('GET', '/admin/stat', {}, adminToken)
  check('GET /admin/stat 仅凭 token 可鉴权', res.code === 0 && res.data.orders > 0, JSON.stringify(res))

  res = await call('GET', '/admin/user/list', { page: 1, size: 5 }, adminToken)
  check('GET /admin/user/list 仅凭 token 可鉴权', res.code === 0 && res.data.total >= 3, JSON.stringify(res))

  /* 26. 不存在的接口 */
  res = await call('GET', '/not/exists', {})
  check('GET /not/exists 返回接口不存在', res.code !== 0, JSON.stringify(res))

  console.log('  ------------------------------------------------------------')
  console.log('  自测完成：通过 ' + passed + ' 项，失败 ' + failed + ' 项')
  console.log('')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(function (e) {
  console.error('  [ERROR] ' + e.message)
  process.exit(1)
})
