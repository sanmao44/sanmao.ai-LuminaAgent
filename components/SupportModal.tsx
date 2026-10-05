"use client";

import type { ComponentType } from "react";

export type SupportTab = "community" | "reward";
type SupportModalIcon = ComponentType<{ name: string; size?: number }>;

export type SupportModalProps = {
  tab: SupportTab;
  Icon: SupportModalIcon;
  onTabChange: (tab: SupportTab) => void;
  onClose: () => void;
  onCopyGroup: () => void | Promise<void>;
  onCopyWechat: () => void | Promise<void>;
};

export default function SupportModal({
  tab,
  Icon,
  onTabChange,
  onClose,
  onCopyGroup,
  onCopyWechat,
}: SupportModalProps) {
  return (
    <div
      className="support-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="support-modal-title">
        <header className="support-modal-head">
          <div className="support-modal-title">
            <span className="support-modal-logo">S</span>
            <div>
              <small>SANMAO.AI COMMUNITY</small>
              <h2 id="support-modal-title">交流与支持</h2>
            </div>
          </div>
          <button type="button" className="support-modal-close" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="support-tabs" role="tablist" aria-label="交流与支持选项">
          <button type="button" role="tab" aria-selected={tab === "community"} className={tab === "community" ? "active" : ""} onClick={() => onTabChange("community")}>
            <span className="support-tab-icon qq">Q</span>
            <span>QQ 交流群</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "reward"} className={tab === "reward" ? "active" : ""} onClick={() => onTabChange("reward")}>
            <span className="support-tab-icon reward">¥</span>
            <span>赞赏开发</span>
          </button>
        </div>
        <div className="support-modal-body">
          {tab === "community" ? (
            <div className="support-community-panel" role="tabpanel">
              <div className="support-community-hero">
                <span className="support-community-orb"><img src="/brand-mark.png" alt="SANMAO.AI" /></span>
                <div>
                  <span>官方 QQ 交流群</span>
                  <strong>1104660815</strong>
                  <small>交流创作技巧、反馈问题，也能第一时间获取更新动态</small>
                </div>
              </div>
              <button type="button" className="support-copy-button" onClick={() => void onCopyGroup()}>
                <Icon name="copy" size={15} />
                复制群号
              </button>
              <div className="support-community-note">
                <span>加入方式</span>
                <p>打开 QQ → 搜索群号 → 申请加入</p>
              </div>
            </div>
          ) : (
            <div className="support-reward-panel" role="tabpanel">
              <div className="support-reward-copy">
                <span>自愿赞赏</span>
                <h3>每一份支持，都会变成下一次更新</h3>
                <p>如果 SANMAO.AI 帮到了你，可以扫码请开发者喝杯咖啡。完全自愿，不影响任何功能。</p>
              </div>
              <div className="support-qr-card">
                <img src="/mm-reward-qrcode.png" alt="SANMAO.AI 赞赏码" />
                <small>微信扫码赞赏</small>
              </div>
            </div>
          )}
        </div>
        <footer className="support-modal-foot">
          <span>感谢你的反馈、陪伴与支持</span>
          <button type="button" onClick={() => void onCopyWechat()}>联系作者 · 微信 wcsanmao</button>
        </footer>
      </section>
    </div>
  );
}
