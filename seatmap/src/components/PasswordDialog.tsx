import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  hint?: string;
  confirmText?: string;
  loading?: boolean;
  error?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export default function PasswordDialog({
  open,
  title,
  hint,
  confirmText = '确认',
  loading,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (open) setPassword('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {hint ? <p className="muted small">{hint}</p> : null}
        <input
          className="modal-input"
          type="password"
          autoFocus
          placeholder="请输入密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && password) onSubmit(password);
          }}
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={!password || loading}
            onClick={() => onSubmit(password)}
          >
            {loading ? '验证中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
