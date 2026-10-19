CREATE DATABASE IF NOT EXISTS math_path CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE math_path;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(254) NULL UNIQUE,
  email_verified_at DATETIME NULL,
  nickname VARCHAR(32) NOT NULL,
  grade VARCHAR(16) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student','admin') NOT NULL DEFAULT 'student',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  status_reason VARCHAR(300) NOT NULL DEFAULT '',
  status_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  purpose ENUM('verify_email','login','reset_password') NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_email_codes_lookup (user_id, purpose, created_at)
);

CREATE TABLE IF NOT EXISTS password_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learner_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  daily_goal_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  learning_direction VARCHAR(32) NOT NULL DEFAULT '',
  learning_goal VARCHAR(160) NOT NULL DEFAULT '',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS study_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  category ENUM('练习','复习','预习','订正') NOT NULL,
  title VARCHAR(80) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  studied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_study_records_user_date (user_id, studied_at)
);

CREATE TABLE IF NOT EXISTS courses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_courses_user_updated (user_id, updated_at),
  admin_status VARCHAR(16) NOT NULL DEFAULT 'active',
  admin_reason VARCHAR(300) NOT NULL DEFAULT '',
  admin_changed_at DATETIME NULL,
  admin_version INT UNSIGNED NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS course_chapters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  source_regions_json JSON NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  INDEX idx_chapters_course_order (course_id, sort_order, id)
);

CREATE TABLE IF NOT EXISTS course_materials (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL DEFAULT '',
  size_bytes BIGINT UNSIGNED NOT NULL,
  extracted_text LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  INDEX idx_materials_course_created (course_id, created_at),
  admin_status VARCHAR(16) NOT NULL DEFAULT 'active',
  admin_reason VARCHAR(300) NOT NULL DEFAULT '',
  admin_changed_at DATETIME NULL,
  admin_version INT UNSIGNED NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS course_chapter_drafts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  source_regions_json JSON NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  INDEX idx_chapter_drafts_course_order (course_id, sort_order, id)
);

CREATE TABLE IF NOT EXISTS admin_action_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id BIGINT UNSIGNED NULL,
  actor_account VARCHAR(64) NOT NULL,
  actor_role VARCHAR(16) NOT NULL DEFAULT 'admin',
  action VARCHAR(40) NOT NULL,
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  result VARCHAR(16) NOT NULL,
  detail VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_log_date (created_at),
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS platform_announcements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  body TEXT NOT NULL,
  placement VARCHAR(16) NOT NULL DEFAULT 'home',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  published_at DATETIME NULL,
  ends_at DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_announcement_public (status,placement,deleted_at,ends_at)
);

CREATE TABLE IF NOT EXISTS platform_service_settings (
  kind VARCHAR(16) PRIMARY KEY,
  config_json JSON NOT NULL,
  encrypted_secret TEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS platform_service_checks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,
  config_version INT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL,
  elapsed_ms INT UNSIGNED NULL,
  summary VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  INDEX idx_service_check_kind (kind,id)
);

CREATE TABLE IF NOT EXISTS admin_task_retries (
  source VARCHAR(12) NOT NULL,
  old_id BIGINT UNSIGNED NOT NULL,
  new_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source,old_id)
);

-- 管理端可恢复的课程与资料暂停状态（已有数据库由 ensureAdminContent 自动迁移）。
-- courses、course_materials 均增加 admin_status、admin_reason、admin_changed_at、admin_version。
CREATE TABLE IF NOT EXISTS material_preview_repairs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  material_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL,
  active_key BIGINT UNSIGNED NULL UNIQUE,
  error_text VARCHAR(300) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES course_materials(id) ON DELETE CASCADE
);
