USE math_path;

ALTER TABLE course_materials
  ADD COLUMN preview_name VARCHAR(255) NULL AFTER size_bytes;
