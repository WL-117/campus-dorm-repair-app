-- ============================================================
-- 校园宿舍线上报修 APP —— MySQL 8.0 数据库结构
-- 字符集统一 utf8mb4，兼容中文与 emoji
-- 执行方式：mysql -u <user> -p <database> < schema.sql
-- 本文件由 server/db.js 在服务启动时自动执行（全部为 CREATE TABLE IF NOT EXISTS，可重复执行）
-- ============================================================

-- 三张表的字段与前端 common/mock-server.uts 一一对应
-- 时间字段保留「yyyy-MM-dd HH:mm」字符串格式，与前端展示、原 JSON 版本完全一致
-- seq 为自增序列：工单 / 公告按 seq DESC 排序（等价于原版本「新数据置顶」），用户按 seq ASC 排序

CREATE TABLE IF NOT EXISTS t_user (
  seq         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '自增序列，用于稳定排序',
  id          VARCHAR(32)  NOT NULL                COMMENT '用户ID',
  username    VARCHAR(64)  NOT NULL                COMMENT '登录账号',
  password    VARCHAR(128) NOT NULL                COMMENT '登录密码（课程演示为明文，生产环境应改为哈希）',
  nickname    VARCHAR(64)  NOT NULL DEFAULT ''     COMMENT '昵称',
  phone       VARCHAR(20)  NOT NULL DEFAULT ''     COMMENT '手机号',
  avatar      VARCHAR(255) NOT NULL DEFAULT ''     COMMENT '头像地址',
  gender      VARCHAR(8)   NOT NULL DEFAULT ''     COMMENT '性别',
  dorm        VARCHAR(64)  NOT NULL DEFAULT ''     COMMENT '宿舍号 / 所属部门',
  role        VARCHAR(16)  NOT NULL DEFAULT 'student' COMMENT '角色：student（学生）/ admin（管理员）',
  create_time VARCHAR(20)  NOT NULL DEFAULT ''     COMMENT '注册时间 yyyy-MM-dd HH:mm',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_seq (seq),
  UNIQUE KEY uk_username (username),
  KEY idx_phone (phone),
  KEY idx_role (role)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户表';

CREATE TABLE IF NOT EXISTS t_repair_order (
  seq         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '自增序列，用于稳定排序',
  id          VARCHAR(32)  NOT NULL                COMMENT '工单ID',
  order_no    VARCHAR(32)  NOT NULL                COMMENT '工单编号 BX+年月日时分秒+随机数',
  user_id     VARCHAR(32)  NOT NULL                COMMENT '提交人ID，关联 t_user.id',
  user_name   VARCHAR(64)  NOT NULL DEFAULT ''     COMMENT '提交人昵称（冗余存储，列表直接展示）',
  category    VARCHAR(32)  NOT NULL                COMMENT '故障分类',
  building    VARCHAR(32)  NOT NULL DEFAULT ''     COMMENT '宿舍楼栋',
  room        VARCHAR(16)  NOT NULL DEFAULT ''     COMMENT '宿舍号',
  contact     VARCHAR(20)  NOT NULL DEFAULT ''     COMMENT '联系电话',
  description TEXT         NOT NULL                COMMENT '故障描述',
  images      TEXT         NOT NULL                COMMENT '图片地址，逗号分隔',
  level       VARCHAR(8)   NOT NULL DEFAULT '普通'  COMMENT '紧急程度：普通 / 紧急',
  status      CHAR(1)      NOT NULL DEFAULT '0'    COMMENT '状态：0待处理 1维修中 2已完成 3已取消',
  create_time VARCHAR(20)  NOT NULL DEFAULT ''     COMMENT '创建时间 yyyy-MM-dd HH:mm',
  update_time VARCHAR(20)  NOT NULL DEFAULT ''     COMMENT '更新时间 yyyy-MM-dd HH:mm',
  remark      TEXT         NOT NULL                COMMENT '管理员处理备注',
  logs        LONGTEXT     NOT NULL                COMMENT '进度日志，JSON 数组 [{time, content}]',
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_seq (seq),
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_user (user_id),
  KEY idx_status_time (status, create_time),
  KEY idx_level (level),
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES t_user (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '报修工单表';

CREATE TABLE IF NOT EXISTS t_notice (
  seq     BIGINT       NOT NULL AUTO_INCREMENT COMMENT '自增序列，用于稳定排序',
  id      VARCHAR(32)  NOT NULL                COMMENT '公告ID',
  title   VARCHAR(128) NOT NULL                COMMENT '公告标题',
  content TEXT         NOT NULL                COMMENT '公告正文',
  time    VARCHAR(20)  NOT NULL DEFAULT ''     COMMENT '发布时间 yyyy-MM-dd HH:mm',
  tag     VARCHAR(32)  NOT NULL DEFAULT '通知'  COMMENT '标签',
  PRIMARY KEY (id),
  UNIQUE KEY uk_notice_seq (seq),
  KEY idx_time (time)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '公告表';
