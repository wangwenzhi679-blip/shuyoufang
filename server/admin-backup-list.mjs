import { z } from 'zod';

const filters = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  status: z.enum(['', 'done', 'failed', 'running']).default(''),
});
export async function backupList(db, input, busy) {
  const parsed = filters.safeParse(input);
  if (!parsed.success) throw Object.assign(new Error('备份查询条件不正确'), { status: 400 });
  const { status } = parsed.data,
    pageSize = 20;
  const condition =
    status === 'done'
      ? " AND status='done'"
      : status === 'failed'
        ? " AND (status='failed' OR verify_status='failed')"
        : status === 'running'
          ? " AND (status IN ('running','deleting') OR verify_status='running')"
          : '';
  const where = "WHERE status<>'deleted'" + condition;
  const [[row]] = await db.query('SELECT COUNT(*) AS total FROM platform_backups ' + where);
  const total = Number(row.total),
    page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / pageSize)));
  const [items] = await db.query(
    'SELECT id,status,verify_status,error_text,created_at,verified_at,size_bytes FROM platform_backups ' +
      where +
      ` ORDER BY created_at DESC,id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
  );
  return { items, total, page, pageSize, status, busy };
}
