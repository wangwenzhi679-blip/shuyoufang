USE math_path;

CREATE TABLE IF NOT EXISTS chapter_question_drafts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  chapter_id BIGINT UNSIGNED NOT NULL,
  settings_json JSON NOT NULL,
  questions_json JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_chapter_question_draft (course_id, chapter_id),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapter_practices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  chapter_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,
  INDEX idx_practices_chapter_created (chapter_id, created_at)
);

CREATE TABLE IF NOT EXISTS practice_questions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  practice_id BIGINT UNSIGNED NOT NULL,
  question_type VARCHAR(20) NOT NULL,
  question_text TEXT NOT NULL,
  options_json JSON NOT NULL,
  answer_text TEXT NOT NULL,
  analysis_text TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES chapter_practices(id) ON DELETE CASCADE,
  INDEX idx_practice_questions_order (practice_id, sort_order)
);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  practice_id BIGINT UNSIGNED NOT NULL,
  answers_json JSON NOT NULL,
  correct_count INT UNSIGNED NOT NULL,
  total_count INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (practice_id) REFERENCES chapter_practices(id) ON DELETE CASCADE,
  INDEX idx_practice_attempts_practice_created (practice_id, created_at)
);
