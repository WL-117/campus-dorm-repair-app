'use strict'
/**
 * 把旧的 JSON 数据文件（data/db.json）迁移进 MySQL
 * ------------------------------------------------------------------
 * 用法：node scripts/import-json.js [json文件路径]
 * 默认读取 server/data/db.json，按「用户 -> 公告 -> 工单」顺序写入，
 * 使用 REPLACE INTO 保证可重复执行（同 ID 覆盖，不会产生重复数据）。
 * 迁移完成后可用 Navicat 打开数据库核对，再决定是否保留 db.json。
 */

const fs = require('fs')
const path = require('path')
const db = require('../db')
const config = require('../config')

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'db.json')

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE
  if (!fs.existsSync(file)) {
    console.error('[import] 找不到数据文件：' + file)
    process.exit(1)
  }

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const users = Array.isArray(parsed.users) ? parsed.users : []
  const orders = Array.isArray(parsed.orders) ? parsed.orders : []
  const notices = Array.isArray(parsed.notices) ? parsed.notices : []

  await db.init()
  const pool = db.getPool()

  let userCount = 0
  let noticeCount = 0
  let orderCount = 0

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    for (const u of users) {
      await conn.execute(
        'REPLACE INTO t_user (id, username, password, nickname, phone, avatar, gender, dorm, role, create_time)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [u.id, u.username, u.password || '', u.nickname || '', u.phone || '', u.avatar || '',
          u.gender || '', u.dorm || '', u.role || 'student', u.createTime || ''])
      userCount++
    }

    for (const n of notices) {
      await conn.execute(
        'REPLACE INTO t_notice (id, title, content, time, tag) VALUES (?, ?, ?, ?, ?)',
        [n.id, n.title || '', n.content || '', n.time || '', n.tag || '通知'])
      noticeCount++
    }

    for (const o of orders) {
      const images = Array.isArray(o.images) ? o.images.join(',') : String(o.images || '')
      const logs = Array.isArray(o.logs) ? o.logs : []
      await conn.execute(
        'REPLACE INTO t_repair_order (id, order_no, user_id, user_name, category, building, room, contact,' +
        ' description, images, level, status, create_time, update_time, remark, logs)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [o.id, o.orderNo || '', o.userId || '', o.userName || '', o.category || '', o.building || '',
          o.room || '', o.contact || '', o.description || '', images, o.level || '普通',
          String(o.status || '0'), o.createTime || '', o.updateTime || '', o.remark || '',
          JSON.stringify(logs)])
      orderCount++
    }

    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  const counts = await db.counts()
  console.log('[import] 迁移完成 -> 数据库 ' + config.mysql.database)
  console.log('[import] 用户 ' + userCount + ' 条 / 公告 ' + noticeCount + ' 条 / 工单 ' + orderCount + ' 条（写入）')
  console.log('[import] 当前库内总数：用户 ' + counts.users + '，工单 ' + counts.orders + '，公告 ' + counts.notices)

  await db.close()
}

main().catch(function (e) {
  console.error('[import] 迁移失败：' + e.message)
  process.exit(1)
})
