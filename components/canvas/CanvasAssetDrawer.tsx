"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";
import { hideUnifiedAsset, listAssetCollections, listUnifiedAssets, saveAssetCollections, setUnifiedAssetFavorite, updateUnifiedAssetMetadata, type AssetRecord, type AssetSource } from "@/lib/assets";
import { DEFAULT_ASSET_COLLECTIONS, type AssetCollection } from "@/lib/client-history";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import { ASSET_SOURCE_LABELS, filterCanvasAssets, isAssignableCanvasAssetCollection } from "@/lib/canvas/asset-library";
import CanvasAudioPlayer from "@/components/canvas/CanvasAudioPlayer";
import SelectMenu from "@/components/SelectMenu";

type Notice = { message: string; kind: "ok" | "error" };

export default function CanvasAssetDrawer({
  extraAssets,
  refresh,
  collectionSelection,
  onCollectionSelectionChange,
  canReference,
  onAdd,
  onReference,
  onLocate,
  onAddNodeToCollection,
  onClose,
  onOpenWorkbench,
  onNotify,
}: {
  extraAssets: AssetRecord[];
  refresh: number;
  collectionSelection: string;
  onCollectionSelectionChange: (collectionId: string) => void;
  canReference: boolean;
  onAdd: (asset: AssetRecord) => void;
  onReference: (asset: AssetRecord) => void;
  onLocate: (asset: AssetRecord) => void;
  onAddNodeToCollection: (nodeId: string, collectionId: string) => void;
  onClose: () => void;
  onOpenWorkbench: () => void;
  onNotify: (message: string, kind?: Notice["kind"]) => void;
}) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const extraAssetsRef = useRef(extraAssets);
  extraAssetsRef.current = extraAssets;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const hasLoadedAssetsRef = useRef(false);
  const assetLoadVersionRef = useRef(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "image" | "video" | "audio">("all");
  const [source, setSource] = useState<"all" | AssetSource>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [preview, setPreview] = useState<AssetRecord | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [collections, setCollections] = useState<AssetCollection[]>(DEFAULT_ASSET_COLLECTIONS);
  const [collection, setCollection] = useState(collectionSelection || "all");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [nodeDropActive, setNodeDropActive] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!preview) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [preview]);

  useEffect(() => {
    let active = true;
    void listAssetCollections().then((items) => {
      if (!active) return;
      setCollections(items);
      const valid = collectionSelection === "all" || items.some((item) => item.id === collectionSelection);
      const next = valid ? collectionSelection : "all";
      setCollection(next);
      onCollectionSelectionChange(next);
    });
    return () => {
      active = false;
    };
  }, [collectionSelection, onCollectionSelectionChange]);

  useEffect(() => {
    setCollection((current) => current === collectionSelection ? current : collectionSelection);
  }, [collectionSelection]);

  const changeCollection = (next: string) => {
    setCollection(next);
    onCollectionSelectionChange(next);
  };

  const reload = useCallback(() => {
    const loadVersion = ++assetLoadVersionRef.current;
    if (!hasLoadedAssetsRef.current) setLoading(true);
    void listUnifiedAssets(extraAssetsRef.current)
      .then((nextAssets) => {
        if (loadVersion !== assetLoadVersionRef.current) return;
        setAssets(nextAssets);
        hasLoadedAssetsRef.current = true;
      })
      .catch(() => {
        if (loadVersion === assetLoadVersionRef.current)
          onNotifyRef.current("资产中心读取失败，请稍后重试。", "error");
      })
      .finally(() => {
        if (loadVersion !== assetLoadVersionRef.current) return;
        hasLoadedAssetsRef.current = true;
        setLoading(false);
      });
  }, []);

  useEffect(reload, [refresh, reload]);

  useEffect(() => {
    const clearNodeDropState = () => setNodeDropActive(false);
    window.addEventListener("dragend", clearNodeDropState);
    window.addEventListener("drop", clearNodeDropState);
    return () => {
      window.removeEventListener("dragend", clearNodeDropState);
      window.removeEventListener("drop", clearNodeDropState);
    };
  }, []);

  const setDrawerCollapsed = (value: boolean) => {
    setCollapsed(value);
  };

  const handleCanvasNodeDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (
      !event.dataTransfer.types.includes("application/x-sanmao-canvas-node")
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setNodeDropActive(true);
  };

  const handleCanvasNodeDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setNodeDropActive(false);
  };

  const handleCanvasNodeDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (
      !event.dataTransfer.types.includes("application/x-sanmao-canvas-node")
    )
      return;
    event.preventDefault();
    const nodeId = event.dataTransfer.getData(
      "application/x-sanmao-canvas-node",
    );
    setNodeDropActive(false);
    if (!nodeId) return;
    if (!isAssignableCanvasAssetCollection(collection)) {
      onNotify("请先选择未分类或自定义资产集合，再放入节点。", "error");
      return;
    }
    onAddNodeToCollection(nodeId, collection);
  };

  const filtered = filterCanvasAssets(assets, {
    collection,
    kind,
    source,
    favoritesOnly,
    query,
    tagFilter,
    sort,
  });

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const item: AssetCollection = { id: `collection_${Date.now().toString(36)}`, name, createdAt: Date.now(), updatedAt: Date.now() };
    const next = [...collections, item];
    setCollections(next); setNewCollectionName("");
    await saveAssetCollections(next);
    setCollection(item.id);
    onCollectionSelectionChange(item.id);
  };

  const deleteCollection = async (collectionId: string) => {
    const target = collections.find((item) => item.id === collectionId);
    if (!target || target.builtin) {
      onNotify("内置资产集合不能删除。", "error");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`确定删除资产集合“${target.name}”吗？集合内资产不会被删除。`)) return;
    try {
      const affectedAssets = assets.filter((asset) => asset.collectionIds?.includes(collectionId));
      await Promise.all(
        affectedAssets.map((asset) =>
          updateUnifiedAssetMetadata(asset, {
            collectionIds: asset.collectionIds.filter((id) => id !== collectionId),
          }),
        ),
      );
      const next = collections.filter((item) => item.id !== collectionId);
      await saveAssetCollections(next);
      setCollections(next);
      setAssets((items) =>
        items.map((asset) =>
          asset.collectionIds?.includes(collectionId)
            ? { ...asset, collectionIds: asset.collectionIds.filter((id) => id !== collectionId) }
            : asset,
        ),
      );
      if (collection === collectionId) changeCollection("all");
      onNotify(`已删除资产集合“${target.name}”，其中的资产已保留。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合删除失败。", "error");
    }
  };

  const renameCollection = async (collectionId: string) => {
    const target = collections.find((item) => item.id === collectionId);
    if (!target || target.builtin) {
      onNotify("内置资产集合不能重命名。", "error");
      return;
    }
    const nextName = window.prompt("重命名资产集合", target.name)?.trim();
    if (!nextName || nextName === target.name) return;
    const next = collections.map((item) => item.id === collectionId ? { ...item, name: nextName, updatedAt: Date.now() } : item);
    try {
      await saveAssetCollections(next);
      setCollections(next);
      onNotify(`已将资产集合重命名为“${nextName}”。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "资产集合重命名失败。", "error");
    }
  };

  const addSelectedAssetsToCollection = async () => {
    if (collection === "all" || collection === "uncategorized" || collection === "favorite" || collection === "recent" || collection === "generated" || collection === "reference" || collection === "image" || collection === "video" || collection === "audio") {
      onNotify("请先在集合筛选中选择一个自定义集合，再批量归类。", "error");
      return;
    }
    const selected = assets.filter((asset) => selectedAssetIds.has(asset.id));
    if (!selected.length) return;
    try {
      await Promise.all(selected.map((asset) => updateUnifiedAssetMetadata(asset, { collectionIds: [...new Set([...(asset.collectionIds || []), collection])] })));
      setAssets((items) => items.map((asset) => selectedAssetIds.has(asset.id) ? { ...asset, collectionIds: [...new Set([...(asset.collectionIds || []), collection])] } : asset));
      setSelectedAssetIds(new Set());
      onNotify(`已将 ${selected.length} 个资产加入“${collections.find((item) => item.id === collection)?.name || "当前集合"}”。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "批量归类失败。", "error");
    }
  };

  const toggleFavorite = async (asset: AssetRecord) => {
    try {
      await setUnifiedAssetFavorite(asset, !asset.favorite);
      setAssets((items) =>
        items.map((item) =>
          item.id === asset.id ? { ...item, favorite: !item.favorite } : item,
        ),
      );
    } catch {
      onNotify("收藏状态保存失败。", "error");
    }
  };

  const hideAsset = async (asset: AssetRecord) => {
    try {
      await hideUnifiedAsset(asset);
      setAssets((items) => items.filter((item) => item.id !== asset.id));
      if (preview?.id === asset.id) setPreview(null);
      onNotify("已从资产索引隐藏，画布引用和磁盘文件保持不变。");
    } catch {
      onNotify("暂时无法隐藏这个资产。", "error");
    }
  };

  if (collapsed)
    return (
      <button
        type="button"
        className="canvas-asset-drawer-collapsed"
        onClick={() => setDrawerCollapsed(false)}
        aria-label={`展开全局资产中心，共 ${assets.length} 个资产`}
        title="展开全局资产中心"
      >
        <span>◈</span>
        <b>{assets.length}</b>
      </button>
    );

  return (
    <>
      <aside
        className={`canvas-asset-drawer ${nodeDropActive ? "is-node-drop-target" : ""}`}
        aria-label="全局资产中心"
        onDragOver={handleCanvasNodeDragOver}
        onDragLeave={handleCanvasNodeDragLeave}
        onDrop={handleCanvasNodeDrop}
      >
        <header>
          <div>
            <span>◈</span>
            <span>
              <b>全局资产中心</b>
              <small>历史、视频任务与所有画布</small>
            </span>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setDrawerCollapsed(true)}
              aria-label="收起资产中心"
              title="收起为窄轨"
            >
              —
            </button>
            <button type="button" onClick={onClose} aria-label="关闭资产中心">
              ×
            </button>
          </div>
        </header>
        <div className="canvas-asset-toolbar">
          <label className="canvas-asset-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、提示词或模型…"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")}>
                ×
              </button>
            )}
          </label>
          <label className="canvas-asset-search"><span>#</span><input value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} placeholder="按标签筛选…" /></label>
          <div className="canvas-asset-kind" role="group" aria-label="资产类型">
            <button
              type="button"
              className={kind === "all" ? "active" : ""}
              onClick={() => setKind("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={kind === "image" ? "active" : ""}
              onClick={() => setKind("image")}
            >
              图片
            </button>
            <button
              type="button"
              className={kind === "video" ? "active" : ""}
              onClick={() => setKind("video")}
            >
              视频
            </button>
            <button
              type="button"
              className={kind === "audio" ? "active" : ""}
              onClick={() => setKind("audio")}
            >
              音频
            </button>
            <button
              type="button"
              className={favoritesOnly ? "active favorite" : ""}
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              ★ 收藏
            </button>
          </div>
          <div className="canvas-asset-filters">
            <div className="canvas-asset-collection-picker">
              <SelectMenu
                value={collection}
                portalZIndex={CANVAS_Z_INDEX.assetDrawer}
                onChange={changeCollection}
                onDelete={(id) => void deleteCollection(id)}
                ariaLabel="资产集合"
                options={collections.map((item) => ({
                  value: item.id,
                  label: item.name,
                  deletable: !item.builtin,
                }))}
              />
              <button type="button" disabled={collection === "all" || !collections.some((item) => item.id === collection && item.builtin !== true)} onClick={() => void renameCollection(collection)} title="重命名当前自定义集合" aria-label="重命名当前资产集合">✎</button>
            </div>
            <SelectMenu
              value={source}
              portalZIndex={CANVAS_Z_INDEX.assetDrawer}
              onChange={setSource}
              ariaLabel="资产来源"
              options={[
                { value: "all", label: "全部来源" },
                ...Object.entries(ASSET_SOURCE_LABELS).map(
                  ([value, label]) => ({ value: value as AssetSource, label }),
                ),
              ]}
            />
            <SelectMenu
              value={sort}
              portalZIndex={CANVAS_Z_INDEX.assetDrawer}
              onChange={setSort}
              ariaLabel="资产排序"
              options={[
                { value: "newest", label: "最新优先" },
                { value: "oldest", label: "最早优先" },
                { value: "name", label: "按名称" },
              ]}
            />
          </div>
        </div>
        {!canReference && (
          <div className="canvas-asset-reference-hint">
            要建立参考关系，请先明确选中一个节点或对象组；多选不会隐式冒充单节点。
          </div>
        )}
        <div className={`canvas-asset-collection-dropzone ${isAssignableCanvasAssetCollection(collection) ? "" : "needs-collection"}`}>
          <span>⌘</span><b>{isAssignableCanvasAssetCollection(collection) ? "把画布节点拖到这里归类" : "先选择未分类或自定义集合"}</b><small>{isAssignableCanvasAssetCollection(collection) ? "拖动节点右上角 ↗，节点不会从画布移除" : "智能筛选视图不能作为归类目标"}</small>
        </div>
        <div className="canvas-asset-new-collection" aria-label="新建资产合集">
          <div className="canvas-asset-new-collection-head">
            <span className="canvas-asset-new-collection-icon" aria-hidden="true">＋</span>
            <span>
              <b>新建合集</b>
              <small>创建后自动切换到新合集</small>
            </span>
          </div>
          <div className="canvas-asset-new-collection-form">
            <input value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="输入合集名称，例如：灵感参考" aria-label="新合集名称" onKeyDown={(event) => { if (event.key === "Enter") void createCollection(); }} />
            <button type="button" onClick={() => void createCollection()} disabled={!newCollectionName.trim()}><span aria-hidden="true">＋</span>创建</button>
          </div>
        </div>
        {selectedAssetIds.size > 0 && <div className="canvas-asset-bulk-bar"><b>已选 {selectedAssetIds.size} 个</b><button type="button" onClick={() => void addSelectedAssetsToCollection()}>加入当前集合</button><button type="button" onClick={() => setSelectedAssetIds(new Set())}>清除选择</button></div>}
        <div className="canvas-asset-results">
          <div className="canvas-asset-summary">
            <b>{filtered.length} 个资产</b>
            <span>拖到空白画布创建节点，拖到对象组自动加入</span>
          </div>
          {loading ? (
            <div className="canvas-asset-loading">
              <span>✦</span>正在聚合资产…
            </div>
          ) : filtered.length ? (
            <div className="canvas-global-asset-grid">
              {filtered.map((asset) => (
                <article
                  key={asset.id}
                  className="canvas-global-asset-card"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      "application/x-sanmao-asset",
                      JSON.stringify(asset),
                    );
                  }}
                >
                  <button
                    type="button"
                    className="canvas-global-asset-preview"
                    onClick={() => setPreview(asset)}
                  >
                    {asset.kind === "video" ? (
                      <video
                        src={asset.url}
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : asset.kind === "audio" ? (
                      <div className="canvas-global-asset-audio-preview">
                        <span aria-hidden="true">♫</span>
                        <b>参考音频</b>
                      </div>
                    ) : (
                      <img src={asset.url} alt={asset.name} loading="lazy" />
                    )}
                    <span>{asset.kind === "video" ? "▶ 视频" : asset.kind === "audio" ? "♫ 音频" : "▣ 图片"}</span>
                  </button>
                  <div className="canvas-global-asset-copy">
                    <label className="canvas-asset-select"><input type="checkbox" checked={selectedAssetIds.has(asset.id)} onChange={(event) => setSelectedAssetIds((current) => { const next = new Set(current); if (event.target.checked) next.add(asset.id); else next.delete(asset.id); return next; })} aria-label={`选择资产 ${asset.name}`} /><b title={asset.name}>{asset.name}</b></label>
                    <small>
                      {ASSET_SOURCE_LABELS[asset.source]} ·{" "}
                      {asset.createdAt
                        ? new Date(asset.createdAt).toLocaleDateString("zh-CN")
                        : "当前画布"}
                    </small>
                    {asset.prompt && <p>{asset.prompt}</p>}
                  </div>
                  <div className="canvas-global-asset-actions">
                    <button
                      type="button"
                      title="添加到画布"
                      aria-label={`将${asset.name}添加到画布`}
                      onClick={() => onAdd(asset)}
                    >
                      ＋ 画布
                    </button>
                    <button
                      type="button"
                      disabled={!canReference}
                      title={canReference ? "作为当前节点或对象组的参考素材" : "请先选中一个节点或对象组，再添加参考"}
                      aria-label={canReference ? `将${asset.name}作为参考素材` : "添加参考前请先选择节点或对象组"}
                      onClick={() => onReference(asset)}
                    >
                      ⌁ 参考
                    </button>
                    <button
                      type="button"
                      title="在画布中定位此资产"
                      aria-label={`在画布中定位${asset.name}`}
                      onClick={() => onLocate(asset)}
                    >
                      ⌖
                    </button>
                    <button
                      type="button"
                      title="添加标签"
                      aria-label={`给${asset.name}添加标签`}
                      onClick={async () => {
                        const tag = window.prompt("输入标签");
                        if (!tag?.trim()) return;
                        try { await updateUnifiedAssetMetadata(asset, { tags: [...new Set([...(asset.tags || []), tag.trim()])] }); reload(); }
                        catch { onNotify("标签保存失败", "error"); }
                      }}
                    >#</button>
                    <button
                      type="button"
                      className={asset.favorite ? "active" : ""}
                      title={asset.favorite ? "取消收藏" : "加入收藏"}
                      aria-label={asset.favorite ? `取消收藏${asset.name}` : `收藏${asset.name}`}
                      onClick={() => void toggleFavorite(asset)}
                    >
                      ★
                    </button>
                    <a href={asset.url} download={asset.name} title="下载资产" aria-label={`下载${asset.name}`}>
                      ↓
                    </a>
                    <button
                      type="button"
                      className="danger"
                      title="从资产中心隐藏（不会删除画布节点或磁盘文件）"
                      aria-label={`隐藏${asset.name}`}
                      onClick={() => void hideAsset(asset)}
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="canvas-asset-empty">
              <span>◇</span>
              <b>没有匹配的资产</b>
              <small>调整筛选，或从主界面生成、上传素材。</small>
            </div>
          )}
        </div>
      </aside>
      {preview && typeof document !== "undefined" && createPortal(
        <div
          className="canvas-asset-preview-backdrop"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setPreview(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div className="canvas-asset-preview-modal">
            <header>
              <div>
                <b>{preview.name}</b>
                <small>
                  {ASSET_SOURCE_LABELS[preview.source]}
                  {preview.modelName ? ` · ${preview.modelName}` : ""}
                </small>
              </div>
              <button type="button" onClick={() => setPreview(null)}>
                ×
              </button>
            </header>
            <div className="canvas-asset-preview-stage">
              {preview.kind === "video" ? (
                <video src={preview.url} controls autoPlay playsInline />
              ) : preview.kind === "audio" ? (
                <CanvasAudioPlayer src={preview.url} name={preview.name} autoPlay />
              ) : (
                <img src={preview.url} alt={preview.name} />
              )}
            </div>
            <footer>
              <button type="button" onClick={() => onAdd(preview)}>
                ＋ 添加到画布
              </button>
              <button
                type="button"
                disabled={!canReference}
                onClick={() => onReference(preview)}
              >
                ⌁ 作为参考
              </button>
              <a href={preview.url} download={preview.name}>
                ↓ 下载
              </a>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
