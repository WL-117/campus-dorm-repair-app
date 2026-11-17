'use strict'
/**
 * 校园宿舍线上报修 APP —— 后端服务入口
 * ------------------------------------------------------------------
 * 技术选型：Node.js 内置 http 模块（零第三方依赖，装好 Node 即可运行）
 * 数据存储：JSON 文件持久化（server/data/db.json）
 * 接口风格：RESTful，统一返回 { code, message, data }，code = 0 表示业务成功
 *
 * 启动：  node server.js           （或 npm start）
 * 自测：  node test.js             （或 npm test，需先启动本服务）
 * 重置：  node db.js --reset       （或 npm run reset）
 */

const http = require('http')
const os = require('os')
const db = require('./db')
const routes = require('./routes')

const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'
const API_PREFIX = '/api'

/* -------------------------------- 工具方法 -------------------------------- */

/** 统一响应 JSON */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text, 'utf8')
  })
  res.end(text)
}

/** 允许跨域（H5 端 / 浏览器自测时使用） */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,token,authorization')
}

/** 读取请求体（JSON / 表单） */
function readBody(req) {
  return new Promise(function (resolve) {
    let raw = ''
    req.on('data', function (chunk) {
      raw += chunk
      // 简单防护：请求体超过 2MB 直接丢弃
      if (raw.length > 2 * 1024 * 1024) {
        req.destroy()
        resolve({})
      }
    })
    req.on('end', function () {
      if (!raw) return resolve({})
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') return resolve(parsed)
        return resolve({})
      } catch (e) {
        // 兼容 application/x-www-form-urlencoded
        const form = {}
        raw.split('&').forEach(function (item) {
          if (!item) return
          const idx = item.indexOf('=')
          if (idx < 0) return
          form[decodeURIComponent(item.slice(0, idx))] = decodeURIComponent(item.slice(idx + 1).replace(/\+/g, ' '))
        })
        resolve(form)
      }
    })
    req.on('error', function () { resolve({}) })
  })
}

/** 取本机局域网 IP，方便手机 / 模拟器访问 */
function lanAddresses() {
  const list = []
  const nets = os.networkInterfaces()
  Object.keys(nets).forEach(function (name) {
    const items = nets[name] || []
    items.forEach(function (net) {
      if (net.family === 'IPv4' && !net.internal) list.push(net.address)
    })
  })
  return list
}

/** 请求日志：时间 + 方法 + 路径 + 状态码 + 耗时 */
function log(method, path, status, cost, extra) {
  console.log('[' + db.nowTime() + '] ' + method + ' ' + path + '  -> ' + status +
    '  ' + cost + 'ms' + (extra ? '  ' + extra : ''))
}

/* ------------------------------- 服务创建 -------------------------------- */

const server = http.createServer(function (req, res) {
  const start = Date.now()
  setCors(res)

  // 跨域预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'))
  let path = url.pathname
  // 统一去掉 /api 前缀：/api/repair/list 与 /repair/list 等价
  if (path.indexOf(API_PREFIX + '/') === 0) path = path.slice(API_PREFIX.length)
  if (path === API_PREFIX) path = '/'
  if (path === '/' || path === '') path = '/health'

  readBody(req).then(function (body) {
    // query 与 body 合并，body 优先（兼容各端 GET/DELETE 传参差异）
    const params = {}
    url.searchParams.forEach(function (value, key) { params[key] = value })
    Object.keys(body).forEach(function (key) { params[key] = body[key] })

    // 登录凭证：优先取请求头 token，其次取参数 token
    const token = String(req.headers['token'] || req.headers['authorization'] || params['token'] || '')
    const ctx = { token: token, headers: req.headers }
    if (token) params['token'] = token

    let result
    try {
      result = routes.handle(req.method, path, params, ctx)
    } catch (e) {
      console.error('[error] ' + req.method + ' ' + path + ' -> ' + e.message)
      result = routes.fail('服务端异常：' + e.message)
    }

    const status = result.code === 0 ? 200 : 200 // 业务失败仍返回 200，由 code 区分，前端统一处理
    log(req.method, path, status, Date.now() - start, 'code=' + result.code + ' ' + result.message)
    sendJson(res, status, result)
  })
})

/* --------------------------------- 启动 ---------------------------------- */

db.load()

server.listen(PORT, HOST, function () {
  const ips = lanAddresses()
  console.log('')
  console.log('  校园宿舍线上报修 APP —— 后端服务已启动')
  console.log('  ------------------------------------------------------------')
  console.log('  本机访问：        http://127.0.0.1:' + PORT + '/api')
  ips.forEach(function (ip) {
    console.log('  局域网 / 真机访问：http://' + ip + ':' + PORT + '/api')
  })
  console.log('  Android 模拟器：   http://10.0.2.2:' + PORT + '/api')
  console.log('  数据文件：        ' + require('path').join(__dirname, 'data', 'db.json'))
  console.log('  ------------------------------------------------------------')
  console.log('  已注册接口：')
  routes.ROUTES.forEach(function (r) {
    console.log('    ' + (r.method + '        ').slice(0, 8) + r.path)
  })
  console.log('')
})

server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    console.error('[error] 端口 ' + PORT + ' 已被占用，请先关闭占用该端口的程序，或用 PORT=3001 node server.js 换端口启动')
  } else {
    console.error('[error] ' + err.message)
  }
  process.exit(1)
})

// 优雅退出：Ctrl + C 时保存数据
process.on('SIGINT', function () {
  db.save()
  console.log('\n[server] 已停止，数据已保存')
  process.exit(0)
})
