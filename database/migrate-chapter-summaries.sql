USE math_path;

CREATE TABLE IF NOT EXISTS chapter_summaries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  chapter_id BIGINT UNSIGNED NOT NULL,
  summary_text TEXT NOT NULL,
  knowledge_points_json JSON NOT NULL,
  source_names_json JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_chapter_summary (chapter_id),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,
  INDEX idx_chapter_summaries_course (course_id)
);
