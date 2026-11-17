import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { session, signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const { error: err } = await signIn(email, password);
    setBusy(false);
    if (err) setError('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  };

  const handleForgot = async () => {
    if (!email) {
      setError('اكتب بريدك الإلكتروني أولاً ثم اضغط "نسيت كلمة المرور"');
      return;
    }
    setError(null);
    const { error: err } = await resetPassword(email);
    if (err) setError(err);
    else setInfo('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني');
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>جردة القبض</h1>
        <p className="muted">تسجيل الدخول متاح فقط للحسابات المصرح لها</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="البريد الإلكتروني"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="كلمة المرور"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <span className="error-text">{error}</span>}
          {info && <span className="success-text">{info}</span>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'جارٍ الدخول...' : 'دخول'}
          </button>
          <button type="button" className="link-btn" onClick={handleForgot}>
            نسيت كلمة المرور؟
          </button>
        </form>
      </div>
    </div>
  );
}
