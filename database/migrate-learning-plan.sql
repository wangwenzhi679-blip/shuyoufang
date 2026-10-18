USE math_path;

SET @has_learning_direction := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'learner_profiles'
    AND column_name = 'learning_direction'
);
SET @sql := IF(
  @has_learning_direction = 0,
  "ALTER TABLE learner_profiles ADD COLUMN learning_direction VARCHAR(32) NOT NULL DEFAULT '' AFTER daily_goal_minutes",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
