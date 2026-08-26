"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

type AdminSession = {
  required?: boolean;
  authenticated?: boolean;
};

type AdminAccessGateProps = {
  children: ReactNode;
};

async function readAdminSession() {
  const response = await fetch("/api/admin/session", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as AdminSession;
  if (!response.ok) throw new Error("访问权限检查失败");
  return data;
}

export default function AdminAccessGate({ children }: AdminAccessGateProps) {
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionError, setSessionError] = useState("");

  const refresh = async () => {
    setSessionError("");
    const session = await readAdminSession();
    setRequired(Boolean(session.required));
    setAuthenticated(Boolean(session.authenticated));
  };

  useEffect(() => {
    let active = true;
    void readAdminSession()
      .then((session) => {
        if (!active) return;
        setRequired(Boolean(session.required));
        setAuthenticated(Boolean(session.authenticated));
      })
      .catch((reason: unknown) => {
        if (active) setSessionError(reason instanceof Error ? reason.message : "访问权限检查失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "管理员密码错误");
      setPassword("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="canvas-access-page">
        <section className="canvas-access-card" aria-live="polite">
          <span className="canvas-access-mark">✦</span>
          <strong>正在检查访问权限</strong>
          <small>请稍候…</small>
        </section>
      </main>
    );
  }

  if (sessionError) {
    return (
      <main className="canvas-access-page">
        <section className="canvas-access-card">
          <span className="canvas-access-mark">!</span>
          <strong>无法检查访问权限</strong>
          <p>{sessionError}</p>
          <button type="button" onClick={() => {
            setLoading(true);
            setSessionError("");
            void readAdminSession()
              .then((session) => {
                setRequired(Boolean(session.required));
                setAuthenticated(Boolean(session.authenticated));
              })
              .catch((reason: unknown) => setSessionError(reason instanceof Error ? reason.message : "访问权限检查失败"))
              .finally(() => setLoading(false));
          }}>
            重新检查
          </button>
        </section>
      </main>
    );
  }

  if (!required || authenticated) return <>{children}</>;

  return (
    <main className="canvas-access-page">
      <section className="canvas-access-card">
        <span className="canvas-access-mark">✦</span>
        <span className="canvas-access-eyebrow">LAN WORKSPACE</span>
        <h1>进入超级画板</h1>
        <p>这是同一台电脑上的局域网共享画布，请输入管理员密码继续。</p>
        <form onSubmit={login}>
          <label>
            <span>管理员密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              placeholder="请输入管理员密码"
            />
          </label>
          {error && <div className="canvas-access-error" role="alert">{error}</div>}
          <button type="submit" disabled={busy || !password.trim()}>
            {busy ? "验证中…" : "进入画布"}
          </button>
        </form>
        <small className="canvas-access-note">仅建议在可信的家庭或办公局域网使用，不要开放到公网。</small>
      </section>
    </main>
  );
}
