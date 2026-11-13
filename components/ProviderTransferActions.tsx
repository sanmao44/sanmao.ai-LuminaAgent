"use client";

import { useRef, useState, type ComponentType } from "react";

type IconComponent = ComponentType<{ name: string; size?: number }>;

type ImportResult = {
  addedProviders: number;
  updatedProviders: number;
  importedModels: number;
};

export default function ProviderTransferActions({ Icon }: { Icon: IconComponent }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function exportProviders() {
    const password = window.prompt("设置服务商迁移密码（至少 12 个字符；不会保存）");
    if (password === null) return;
    if (password.length < 12) {
      setError(true);
      setMessage("迁移密码至少需要 12 个字符");
      return;
    }
    if (window.prompt("请再次输入迁移密码") !== password) {
      setError(true);
      setMessage("两次输入的密码不一致");
      return;
    }
    if (!window.confirm("导出文件只包含服务商、关联模型和 API Key，并使用该密码加密。请将文件和密码分开保存。")) return;

    setBusy("export");
    setError(false);
    setMessage("");
    try {
      const response = await fetch("/api/providers/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "导出服务商失败");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "SANMAO-providers.sanmao-providers";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setMessage("服务商迁移文件已导出");
    } catch (caught) {
      setError(true);
      setMessage(caught instanceof Error ? caught.message : "导出服务商失败");
    } finally {
      setBusy(null);
    }
  }

  async function importProviders(file: File) {
    const password = window.prompt("请输入导出时设置的迁移密码");
    if (password === null) return;
    if (password.length < 12) {
      setError(true);
      setMessage("迁移密码至少需要 12 个字符");
      return;
    }
    if (!window.confirm("将批量新增或更新文件中的服务商及关联模型。目标电脑上的其他服务商、设置、素材和历史记录会保留。继续导入吗？")) return;

    setBusy("import");
    setError(false);
    setMessage("");
    try {
      const response = await fetch("/api/providers/transfer", {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-SANMAO-Provider-Transfer-Password": encodeURIComponent(password),
        },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "导入服务商失败");
      const result = data as ImportResult;
      setMessage(`已新增 ${result.addedProviders} 个、更新 ${result.updatedProviders} 个服务商，并导入 ${result.importedModels} 个模型`);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (caught) {
      setError(true);
      setMessage(caught instanceof Error ? caught.message : "导入服务商失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="provider-transfer-actions">
      <button type="button" className="ghost-button" onClick={() => void exportProviders()} disabled={busy !== null}>
        <Icon name="download" size={13} />
        {busy === "export" ? "正在导出…" : "导出服务商"}
      </button>
      <button type="button" className="ghost-button" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
        <Icon name="upload" size={13} />
        {busy === "import" ? "正在导入…" : "导入服务商"}
      </button>
      <input
        ref={inputRef}
        className="provider-transfer-file-input"
        type="file"
        accept=".sanmao-providers,application/octet-stream"
        aria-label="选择服务商迁移文件"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importProviders(file);
        }}
      />
      {message ? <small className={`provider-transfer-message${error ? " error" : ""}`} role={error ? "alert" : "status"}>{message}</small> : null}
    </div>
  );
}
