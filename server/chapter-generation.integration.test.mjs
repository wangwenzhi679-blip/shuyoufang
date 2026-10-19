import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { registerChapterGenerationRoutes } from './chapter-generation-routes.js';
import { validatePdfChapterSources } from './pdf-chapter-sources.js';

// 仅显式启用时运行：创建独立临时表，模拟 AI，不修改用户课程或服务配置。
test(
  '真实MySQL中保存失败回滚，重复采用并发串行，不产生半份或重复目录',
  {
    skip: process.env.RUN_DB_INTEGRATION !== '1',
    timeout: 20000,
  },
  async () => {
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 4,
    });
    const names = [
      'courses',
      'course_materials',
      'course_context_cache',
      'course_chapter_drafts',
      'course_chapters',
    ];
    const suffix = `_cg_test_${Date.now()}`;
    const tables = new Map(names.map((name) => [name, `${name}${suffix}`]));
    const rewrite = (sql) =>
      sql.replace(
        /\b(courses|course_materials|course_context_cache|course_chapter_drafts|course_chapters)\b/g,
        (name) => tables.get(name),
      );
    const created = [];
    let failAt = 0,
      inserts = 0;
    const execute = (connection, sql, args) => {
      if (failAt && sql.startsWith('INSERT INTO course_chapter_drafts') && ++inserts === failAt)
        throw new Error('模拟第三章写入中断');
      return connection.execute(rewrite(sql), args);
    };
    const db = {
      execute: (sql, args) => execute(pool, sql, args),
      getConnection: async () => {
        const connection = await pool.getConnection();
        return {
          execute: (sql, args) => execute(connection, sql, args),
          beginTransaction: () => connection.beginTransaction(),
          commit: () => connection.commit(),
          rollback: () => connection.rollback(),
          release: () => connection.release(),
        };
      },
    };
    const res = () => ({
      code: 200,
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    });
    const req = (body = {}) => ({ params: { courseId: '1' }, user: { sub: 2 }, body });
    try {
      const definitions = {
        courses: 'id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL,title VARCHAR(120)',
        course_materials:
          'id BIGINT PRIMARY KEY,course_id BIGINT NOT NULL,original_name VARCHAR(255),stored_name VARCHAR(255),preview_name VARCHAR(255),extracted_text MEDIUMTEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
        course_context_cache:
          'course_id BIGINT NOT NULL,purpose VARCHAR(24),content_hash CHAR(64),result_text MEDIUMTEXT,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(course_id,purpose)',
        course_chapter_drafts:
          'id BIGINT AUTO_INCREMENT PRIMARY KEY,course_id BIGINT NOT NULL,title VARCHAR(120),description VARCHAR(500),sort_order INT,source_regions_json JSON,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
        course_chapters:
          'id BIGINT AUTO_INCREMENT PRIMARY KEY,course_id BIGINT NOT NULL,title VARCHAR(120),description VARCHAR(500),sort_order INT,source_regions_json JSON,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,completed_at TIMESTAMP NULL',
      };
      for (const name of names) {
        await pool.query(
          `CREATE TABLE \`${tables.get(name)}\` (${definitions[name]}) ENGINE=InnoDB`,
        );
        created.push(tables.get(name));
      }
      await db.execute("INSERT INTO courses(id,user_id,title) VALUES(1,2,'合成测试课程')");
      await db.execute(
        "INSERT INTO course_materials(id,course_id,original_name,stored_name,extracted_text) VALUES(7,1,'synthetic.pdf','synthetic.pdf','')",
      );
      await db.execute(
        "INSERT INTO course_chapter_drafts(course_id,title,description,sort_order) VALUES(1,'原有草稿','',1)",
      );
      const generated = Array.from({ length: 30 }, (_, i) => ({
        title: `章节${i + 1}`,
        description: '合成资料',
        sourceRegions: [{ materialId: 7, startPage: i * 9 + 1, endPage: (i + 1) * 9 }],
      }));
      const routes = new Map();
      registerChapterGenerationRoutes(
        { post: (url, ...handlers) => routes.set(url, handlers.at(-1)) },
        {
          db,
          generationSignal: () => new AbortController().signal,
          parseId: (_res, value) => Number(value),
          getOwnedCourse: async (userId, courseId) => {
            const [[course]] = await db.execute(
              'SELECT id,title FROM courses WHERE id=? AND user_id=?',
              [courseId, userId],
            );
            return course;
          },
          getAiModel: async () => 'synthetic-test-model',
          preparePdfOutline: async (_materials, { onSources }) => {
            onSources([{ materialId: 7, pages: 270 }]);
            return '合成的图片分区摘要';
          },
          askDeepSeek: async () => JSON.stringify({ chapters: generated }),
          auth() {},
          asyncRoute: (handler) => handler,
          validationError: (response) => response.status(400).json({ message: 'invalid' }),
        },
      );
      const suggest = routes.get('/api/courses/:courseId/chapters/suggest');
      failAt = 3;
      await assert.rejects(suggest(req(), res()), /第三章写入中断/);
      const [old] = await db.execute('SELECT title FROM course_chapter_drafts WHERE course_id=1');
      assert.deepEqual(
        old.map((row) => row.title),
        ['原有草稿'],
      );
      failAt = 0;
      const generatedResponse = res();
      await suggest(req(), generatedResponse);
      assert.equal(generatedResponse.code, 201);
      assert.equal(generatedResponse.body.chapterDrafts.length, 30);
      const confirm = routes.get('/api/courses/:courseId/chapters/confirm-draft');
      const payload = { chapters: generatedResponse.body.chapterDrafts };
      const results = await Promise.allSettled([
        confirm(req(payload), res()),
        confirm(req(payload), res()),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.find((result) => result.status === 'rejected').reason.status, 409);
      const [chapters] = await db.execute(
        'SELECT title,description,source_regions_json FROM course_chapters WHERE course_id=1 ORDER BY sort_order,id',
      );
      assert.equal(chapters.length, 30);
      validatePdfChapterSources(
        chapters.map((chapter) => ({
          ...chapter,
          sourceRegions:
            typeof chapter.source_regions_json === 'string'
              ? JSON.parse(chapter.source_regions_json)
              : chapter.source_regions_json,
        })),
        [{ materialId: 7, pages: 270 }],
      );
      const [[drafts]] = await db.execute(
        'SELECT COUNT(*) AS count FROM course_chapter_drafts WHERE course_id=1',
      );
      assert.equal(drafts.count, 0);
    } finally {
      try {
        for (const name of created.reverse()) {
          if (!Array.from(tables.values()).includes(name) || !/^[a-z_]+_cg_test_\d+$/.test(name))
            throw new Error('测试表名不安全');
          await pool.query(`DROP TABLE \`${name}\``);
        }
      } finally {
        await pool.end();
      }
    }
  },
);
