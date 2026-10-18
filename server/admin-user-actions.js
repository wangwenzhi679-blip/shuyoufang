import { z } from 'zod';

const accountActionSchema = z.object({
  id: z.coerce.number().int().positive(),
  version: z.number().int().min(0),
  reason: z.string().trim().min(1).max(300),
});

const statusSchema = accountActionSchema.extend({ status: z.enum(['active', 'disabled']) });
const cancellationSchema = accountActionSchema.extend({ account: z.string().min(1).max(64) });
const accountError = (message, status) => Object.assign(new Error(message), { status });

async function lockAccount(connection, id) {
  const [[account]] = await connection.execute(
    'SELECT id,account,role,status,status_version FROM users WHERE id=? FOR UPDATE',
    [id],
  );
  if (!account) throw accountError('用户不存在', 404);
  return account;
}

function assertCurrentVersion(account, version) {
  if (account.status_version !== version) {
    throw accountError('账户状态已变化，请刷新后重试', 409);
  }
}

export function registerAdminUserActions(route, db, audit) {
  route('patch', '/users/:id/status', async (req, res) => {
    const parsed = statusSchema.safeParse({ ...req.body, id: req.params.id });
    if (!parsed.success) {
      return res.status(400).json({ message: '请填写处理原因，检查账户状态' });
    }

    const { id, status, version, reason } = parsed.data;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const account = await lockAccount(connection, id);
      if (account.role === 'admin' || Number(id) === Number(req.user.sub)) {
        throw accountError('不能停用或修改管理员账户状态', 403);
      }
      if (account.status === 'cancelled') {
        throw accountError('账户已注销，不能恢复', 409);
      }
      assertCurrentVersion(account, version);
      if (account.status === status) {
        throw accountError('账户状态已变化，请刷新后重试', 409);
      }

      await connection.execute(
        'UPDATE users SET status=?,status_reason=?,status_version=status_version+1 WHERE id=?',
        [status, reason, id],
      );
      const action = status === 'active' ? 'user_restore' : 'user_disable';
      await audit(connection, req.user, action, id, 'success', reason);
      await connection.commit();
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      await audit(connection, req.user, 'user_status', id, 'failed', '操作未完成');
      throw error;
    } finally {
      connection.release();
    }
  });

  route('post', '/users/:id/cancel', async (req, res) => {
    const parsed = cancellationSchema.safeParse({ ...req.body, id: req.params.id });
    if (!parsed.success) {
      return res.status(400).json({ message: '请填写账号及注销原因' });
    }

    const { id, version, account: confirmedAccount, reason } = parsed.data;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const account = await lockAccount(connection, id);
      if (account.role !== 'student' || Number(id) === Number(req.user.sub)) {
        throw accountError('只能注销学习用户账号', 403);
      }
      if (account.account !== confirmedAccount) {
        throw accountError('输入的账号不一致', 400);
      }
      assertCurrentVersion(account, version);
      if (account.status === 'cancelled') {
        throw accountError('账户状态已变化，请刷新后重试', 409);
      }

      // Keep learning records and revoke access in the same audited transaction.
      await connection.execute(
        `UPDATE users SET status='cancelled',status_reason=?,status_version=status_version+1,
          email=NULL,email_verified_at=NULL WHERE id=?`,
        [reason, id],
      );
      await connection.execute('DELETE FROM email_verification_codes WHERE user_id=?', [id]);
      await audit(connection, req.user, 'user_cancel', id, 'success', reason);
      await connection.commit();
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}
