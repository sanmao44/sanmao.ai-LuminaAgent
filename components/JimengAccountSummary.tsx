'use client';

import type { JimengAccount } from '@/lib/jimeng-cli';

type Props = {
  account?: JimengAccount | null;
  checkedAt?: string;
  error?: string;
  loading?: boolean;
  onRefresh?: () => void;
};

function checkedLabel(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `最近查询：${date.toLocaleTimeString('zh-CN', { hour12: false })}`;
}

export default function JimengAccountSummary({ account, checkedAt, error, loading = false, onRefresh }: Props) {
  return <div className="jimeng-account-summary" aria-live="polite">
    <div className="jimeng-account-heading">
      <div>
        <strong>即梦账户</strong>
        <small>{loading ? '正在查询账户信息…' : checkedLabel(checkedAt) || '打开面板后自动查询积分'}</small>
      </div>
      {onRefresh && <button type="button" className="ghost-button jimeng-account-refresh" disabled={loading} onClick={onRefresh}>{loading ? '查询中…' : '刷新积分'}</button>}
    </div>
    {account ? <div className="jimeng-account-grid">
      <div><span>剩余积分</span><b>{account.totalCredit === null ? '—' : account.totalCredit.toLocaleString('zh-CN')}</b></div>
      <div><span>会员等级</span><b>{account.vipLevel || '—'}</b></div>
      <div><span>账号 ID</span><b title={account.userId || undefined}>{account.userId || '—'}</b></div>
      {account.userName && <div><span>账号名称</span><b title={account.userName}>{account.userName}</b></div>}
    </div> : <div className="jimeng-account-empty">{error || '尚未读取到即梦账户信息。请先完成授权。'}</div>}
    {account && error && <small className="jimeng-account-error">{error}</small>}
  </div>;
}
