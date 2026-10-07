"use client";

import type { ComponentType, FormEvent } from "react";

type AdminLoginIcon = ComponentType<{ name: string; size?: number }>;

export type AdminLoginProps = {
  password: string;
  busy: boolean;
  Icon: AdminLoginIcon;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export default function AdminLogin({
  password,
  busy,
  Icon,
  onPasswordChange,
  onSubmit,
}: AdminLoginProps) {
  return (
    <section className="admin-login-page">
      <form className="admin-login surface" onSubmit={onSubmit}>
        <div className="hero-orb small">
          <Icon name="model" size={21} />
        </div>
        <h1>管理员登录</h1>
        <p>接口服务和模型选择属于平台管理配置。普通使用者不需要进入这里。</p>
        <label>
          <span>管理员密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoFocus
            placeholder="输入管理员密码"
          />
        </label>
        <button className="primary-action" disabled={busy || !password.trim()}>
          {busy ? "验证中…" : "进入管理"}
        </button>
      </form>
    </section>
  );
}
