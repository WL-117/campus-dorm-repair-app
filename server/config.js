'use strict'
/**
 * 后端配置（读取 server/.env，缺失项使用默认值）
 * ------------------------------------------------------------------
 * 不再把账号密码写死在代码里：数据库凭据统一放在 server/.env，
 * 该文件已被 .gitignore 忽略，不会提交到仓库。
 * 模板见 server/.env.example。
 */

const fs = require('fs')
const path = require('path')

/** 轻量 .env 解析（不引入 dotenv，避免多一个第三方依赖） */
function loadEnvFile() {
  const file = path.join(__dirname, '.env')
  if (!fs.existsSync(file)) return
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach(function (line) {
    const text = line.trim()
    if (!text || text.charAt(0) === '#') return
    const idx = text.indexOf('=')
    if (idx < 0) return
    const key = text.slice(0, idx).trim()
    let value = text.slice(idx + 1).trim()
    if (value.length >= 2) {
      const first = value.charAt(0)
      const last = value.charAt(value.length - 1)
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    // 已存在的环境变量优先，便于命令行临时覆盖
    if (process.env[key] === undefined) process.env[key] = value
  })
}

loadEnvFile()

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  apiPrefix: '/api',
  mysql: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dorm_repair',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL || 10),
    queueLimit: 0,
    dateStrings: true
  }
}

module.exports = config
