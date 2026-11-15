import { useCallback, useMemo, useRef } from "react";
import { useReactFlow, type Connection, type Edge, type OnConnectEnd } from "@xyflow/react";
import { pickFiles } from "@/common/pickFiles";
import type { Notify } from "@/common/Toast";
import { newCanvasCard, turnPage as turnPageOf } from "@/domain/cards";
import { patchCard } from "@/domain/sendRefs";
import { IMAGE_ACCEPT, MEDIA_ACCEPT } from "@/domain/media";
import { uploadMedia } from "./uploadMedia";
import { cardPositions, leftOf, rightOf, type Point } from "@/domain/placement";
import { offersConnectionMenu } from "@/domain/menus";
import { checkLink, dropLinkHint, linkId, maxRefsOf, refSources, referenceLimitReached } from "@/domain/refs";
import type { AssetRef, CardPatch, CardNode, CardSource } from "@/types";
import type { PickedMedia } from "@/uploadTypes";
import { pickedAsset } from "@/domain/uploads";
import { usesSceneText } from "@/domain/rewriteTextScene";

function newNodeId(): string {
  return `card-${crypto.randomUUID().slice(0, 8)}`;
}

type Deps = {
  setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void;
  takeNumber: () => number;
  notify: Notify;
  pickWork: (includeVideo?: boolean) => Promise<PickedMedia | null>;
  onBlankConnect: (source: string, screen: Point) => void;
};

/** 往画布上放卡片、连线、断线、翻页、改卡片内容。 */
export function useCards({ setNodes, setEdges, takeNumber, notify, pickWork, onBlankConnect }: Deps) {
  const flow = useReactFlow<CardNode, Edge>();
  const connectHandled = useRef(false);

  /**
   * 放几张卡，返回新卡的编号。row：从指定点往右排，允许重叠；column：从 start 起往下找空位。
   * select = true 时新卡选中、别的取消选中（新建生成卡后提示词面板直接弹出来）。
   */
  const placeCards = useCallback(
    (items: Array<{ source: CardSource; results: AssetRef[]; kind?: "image" | "video"; title?: string }>, start: Point, layout: "row" | "column", select = true): string[] => {
      if (!items.length) return [];
      const positions = cardPositions(start, items.length, flow.getNodes().map((n) => n.position), layout);
      const created: CardNode[] = items.map((item, index) => {
        const kind = item.kind ?? item.results[0]?.media ?? "image";
        return { id: newNodeId(), type: "card", position: positions[index], selected: select,
          data: newCanvasCard(item.source, takeNumber, item.results, kind, item.title) };
      });
      setNodes((nodes) => [...(select ? nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) : nodes), ...created]);
      return created.map((n) => n.id);
    },
    [flow, setNodes, takeNumber]
  );

  const addAssets = useCallback(
    (source: "upload" | "work", refs: Array<AssetRef & { fileName?: string }>, at: Point, layout: "row" | "column" = "row", select = true) =>
      placeCards(refs.map(({ fileName, ...ref }) => ({ source, results: [ref], title: source === "upload" ? fileName : undefined })), at, layout, select),
    [placeCards]
  );

  /** 图片先缩小；视频原样上传。图片卡的参考入口仍只收图片。 */
  const uploadFiles = useCallback(
    (files: File[], includeVideo = true) => uploadMedia(files, includeVideo, notify),
    [notify]
  );

  /** 右边 ＋ → 图片：在右边新建一张生成卡并连线，这张图成了它的「图片1」。 */
  const addDownstream = useCallback(
    (sourceId: string, at?: Point, kind: "image" | "video" = "image") => {
      const source = flow.getNode(sourceId);
      if (!source) return;
      if (source.data.kind === "video" && kind === "image") { notify("出图不能拿视频当参考，连到视频卡上。"); return; }
      if (source.data.kind === "audio" && kind === "image") { notify("出图不能拿声音当参考"); return; }
      const [id] = placeCards([{ source: "generate", results: [], kind }], at ?? rightOf(source.position), "row");
      if (id) setEdges((edges) => [...edges, { id: linkId(sourceId, id), source: sourceId, target: id }]);
    },
    [flow, placeCards, setEdges, notify]
  );

  const addUpstream = useCallback((targetId: string, kind: "image" | "video" = "image") => {
    const target = flow.getNode(targetId);
    if (!target) return;
    const kinds = refSources(flow.getEdges(), targetId).map(id => flow.getNode(id)?.data.kind ?? "image");
    if (referenceLimitReached(kinds, kind, maxRefsOf(target.data))) {
      notify(`一张卡最多连 ${maxRefsOf(target.data)} 张参考图。`);
      return;
    }
    if (kind === "video" && target.data.kind !== "video") { notify("出图不能拿视频当参考，连到视频卡上。"); return; }
    const [id] = placeCards([{ source: "generate", results: [], kind }], leftOf(target.position), "row", false);
    if (id) setEdges(edges => [...edges, { id: linkId(id, targetId), source: id, target: targetId }]);
  }, [flow, notify, placeCards, setEdges]);

  /** 左边 ＋：传图或从作品库选一张，放在这张卡左边并连进来。上限见 maxRefsOf。 */
  const addReference = useCallback(
    async (targetId: string, how: "upload" | "work") => {
      const target = flow.getNode(targetId);
      if (!target) return;
      const kinds = refSources(flow.getEdges(), targetId).map(id => flow.getNode(id)?.data.kind ?? "image");
      let refs: Array<AssetRef & { fileName?: string }> = [], source = how;
      const includeVideo = target.data.kind === "video";
      if (how === "upload") {
        refs = await uploadFiles(await pickFiles(includeVideo ? MEDIA_ACCEPT : IMAGE_ACCEPT), includeVideo);
      } else {
        const picked = await pickWork(includeVideo), asset = picked && pickedAsset(picked);
        if (asset && (includeVideo || asset.kind === "image")) { refs = [asset.ref]; source = asset.source; }
      }
      if (!refs.length) return;
      const ids = addAssets(source, refs, leftOf(target.position), "column", false);
      const linked = ids.filter((_, index) => {
        const kind = refs[index].media ?? "image";
        if (referenceLimitReached(kinds, kind, maxRefsOf(target.data))) return false;
        kinds.push(kind);
        return true;
      });
      if (linked.length !== ids.length) notify(`图和视频加起来最多 ${maxRefsOf(target.data)} 个参考，多出来的素材放在画布上没连。`);
      setEdges((edges) => [...edges, ...linked.map((id) => ({ id: linkId(id, targetId), source: id, target: targetId }))]);
    },
    [flow, notify, uploadFiles, pickWork, addAssets, setEdges]
  );

  /** 拖线和从画布选参考共用校验与提示。 */
  const connect = useCallback(
    (source: string, target: string) => {
      const targetData = flow.getNode(target)?.data;
      const check = checkLink({ edges: flow.getEdges(), source, target, targetSource: targetData?.source, maxRefs: maxRefsOf(targetData),
        sourceKind: flow.getNode(source)?.data.kind, targetKind: targetData?.kind,
        referenceKinds: refSources(flow.getEdges(), target).map(id => flow.getNode(id)?.data.kind ?? "image") });
      if (!check.ok) {
        notify(check.reason);
        return;
      }
      setEdges((edges) => [...edges, { id: linkId(source, target), source, target }]);
      // 11-13 线就是开关：「不出图，用文字」的背景卡又连回视频卡 = 改回用图（字留着）。
      const sourceData = flow.getNode(source)?.data;
      if (sourceData && usesSceneText(sourceData) && targetData?.kind === "video") {
        setNodes((nodes) => nodes.map((n) => (n.id === source ? { ...n, data: patchCard(n.data, { rewriteTextOn: false }) } : n)));
      }
    },
    [flow, notify, setEdges, setNodes]
  );

  const onConnect = useCallback((connection: Connection) => {
    connectHandled.current = true;
    connect(connection.source, connection.target);
  }, [connect]);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      const handled = connectHandled.current;
      connectHandled.current = false;
      if (handled || !state.fromNode || state.fromHandle?.type !== "source") return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!point) return;
      const node = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node");
      const target = node?.getAttribute("data-id") ?? null;
      const element = document.elementFromPoint(point.clientX, point.clientY);
      const blank = Boolean(element?.closest(".react-flow__pane"));
      if (offersConnectionMenu(handled, state.fromHandle?.type, Boolean(state.fromNode), blank)) {
        onBlankConnect(state.fromNode.id, { x: point.clientX, y: point.clientY });
        return;
      }
      const hint = dropLinkHint({
        edges: flow.getEdges(), source: state.fromNode.id, target,
        targetSource: target ? flow.getNode(target)?.data.source : undefined,
        sourceKind: flow.getNode(state.fromNode.id)?.data.kind,
        targetKind: target ? flow.getNode(target)?.data.kind : undefined,
        maxRefs: target ? maxRefsOf(flow.getNode(target)?.data) : undefined,
        referenceKinds: target ? refSources(flow.getEdges(), target).map(id => flow.getNode(id)?.data.kind ?? "image") : []
      });
      if (hint) notify(hint);
    },
    [flow, notify, onBlankConnect]
  );

  const disconnect = useCallback(
    (source: string, target: string) => setEdges((edges) => edges.filter((e) => !(e.source === source && e.target === target))),
    [setEdges]
  );

  const updateCard = useCallback(
    (id: string, patch: CardPatch) => setNodes((nodes) => nodes.map((n) => (n.id === id ? { ...n, data: patchCard(n.data, patch) } : n))),
    [setNodes]
  );

  const turnPage = useCallback(
    (id: string, delta: number) =>
      setNodes((nodes) =>
        nodes.map((n) => {
          if (n.id !== id) return n;
          const data = turnPageOf(n.data, delta);
          return data === n.data ? n : { ...n, data };
        })
      ),
    [setNodes]
  );

  return useMemo(
    () => ({
      addGenerateCard: (at: Point, kind: "image" | "video" = "image") => {
        placeCards([{ source: "generate", results: [], kind }], at, "row");
      },
      addAssets,
      dropFiles: async (files: File[], at: Point) => {
        addAssets("upload", await uploadFiles(files), at);
      },
      uploadAt: async (at: Point) => {
        addAssets("upload", await uploadFiles(await pickFiles(MEDIA_ACCEPT)), at);
      },
      workAt: async (at: Point) => {
        const picked = await pickWork(true), asset = picked && pickedAsset(picked);
        if (asset) addAssets(asset.source, [asset.ref], at);
      },
      addDownstream,
      addUpstream,
      addReference,
      connect,
      onConnect,
      onConnectEnd,
      disconnect,
      updateCard,
      turnPage
    }),
    [placeCards, addAssets, uploadFiles, pickWork, addDownstream, addUpstream, addReference, connect, onConnect, onConnectEnd, disconnect, updateCard, turnPage]
  );
}
