import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Background, BackgroundVariant, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type NodeProps } from "@xyflow/react";
import { BoardContext, type BoardApi } from "@/canvas/boardContext";
import { ImageCard } from "@/canvas/ImageCard";
import { VideoCard } from "@/canvas/VideoCard";
import { AudioCard } from "@/canvas/AudioCard";
import { useLocalMedia } from "@/canvas/useLocalMedia";
import { useLocalStop } from "@/canvas/useLocalStop";
import { Confirm } from "@/common/Confirm";
import { stopConfirmText } from "@/domain/localMedia";
import { useVideoClip } from './useVideoClip';
import { useFrameCapture } from './useFrameCapture';
import { AssetIdDialog } from "@/common/AssetIdDialog";
import { handleCanvasDrop } from './RewriteImageUpload';
import { rewriteDropHighlight } from '@/domain/rewriteDrop';
import { useBoardDoc } from "@/canvas/useBoardDoc";
import { useCards } from "@/canvas/useCards";
import { useJobPolling } from "@/canvas/useJobPolling";
import { useSend } from "@/canvas/useSend";
import { ZoomControl } from "@/canvas/ZoomControl";
import { PopMenu } from "@/common/PopMenu";
import { useGraphHistory } from "@/canvas/useGraphHistory";
import { useBoardActions } from "@/canvas/useBoardActions";
import { useBoardMenus, type PendingLink } from "@/canvas/useBoardMenus";
import { PendingConnection } from "@/canvas/PendingConnection";
import { ShortcutHelp } from "@/canvas/ShortcutHelp";
import { useAltDrag } from "@/canvas/useAltDrag";
import { CutEdge } from "@/canvas/CutEdge";
import type { Notify } from "@/common/Toast";
import { boardPointerControls, shouldShowMultiSelection } from "@/domain/boardControls";
import { boardKeyboardControls } from "@/domain/selection";
import { MAX_ZOOM } from "@/domain/zoom";
import { CONNECTION_DRAG_THRESHOLD } from "@/domain/connectionGesture";
import { WORK_DRAG_TYPE } from "@/library/WorksGrid";
import { WorksPicker } from "@/library/WorksPicker";
import { CanvasMenu } from "@/shell/CanvasMenu";
import { BrandCredit, BrandMark } from "@/shell/BrandMark";
import type { CanvasSummary, CardNode } from "@/types"; import type { PickedMedia } from "@/uploadTypes";
import { useVideoRewrite } from "./useVideoRewrite";
import { useMeasuredRewriteLayout } from "./useMeasuredRewriteLayout";
import { useCardFocus, useRewriteFocus } from "./useRewriteFocus";
import { useBoardGroups } from './useBoardGroups';
import { GroupFrames } from './GroupFrames';
import { cardAtPointer } from './useBoardActions';
import { useBoardCharacters } from './useBoardCharacters';
import { SaveCharacterDialog } from '@/library/SaveCharacterDialog';
import { CHARACTER_DRAG_TYPE } from '@/library/characterEvents';
import { useProductRemake } from './useProductRemake';
import { useLayers } from './useLayers';
import { LayerEditor } from './LayerEditor';

function CardView(props: NodeProps<CardNode>) {
  return props.data.kind === "audio" ? <AudioCard {...props} /> : props.data.kind === "video" ? <VideoCard {...props} /> : <ImageCard {...props} />;
}
const nodeTypes = { card: CardView };
const edgeTypes = { default: CutEdge };
const defaultEdgeOptions = { selectable: false };
/** 双击卡片 = 画布放大对准这张卡；双击卡上的按钮、接点、面板里的字不算。 */
const NOT_FOCUS = "button, a, input, textarea, select, .react-flow__handle, .react-flow__node-toolbar";
const dropNodeId = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('.react-flow__node')?.getAttribute('data-id') ?? null;

export type BoardProps = {
  canvas: CanvasSummary;
  canvases: CanvasSummary[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  worksOpen: boolean;
  onToggleWorks: () => void;
  openViewer: (url: string, title: string, media?: "image" | "video" | "audio") => void;
  notify: Notify;
};

export function CanvasBoard(props: BoardProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

function Board(props: BoardProps) {
  const { canvas, notify, openViewer } = props;
  const flow = useReactFlow<CardNode, Edge>();
  const doc = useBoardDoc(canvas.id, canvas.name, notify);
  const rewriteLayout = useMeasuredRewriteLayout(doc.nodes, doc.setNodes);
  const rewriteFocus = useRewriteFocus(), cardFocus = useCardFocus();
  const send = useSend(canvas.id, doc.setNodes);
  const videoRewrite = useVideoRewrite({ canvasId: canvas.id, nodes: doc.nodes, setNodes: doc.setNodes, setEdges: doc.setEdges,
    takeNumber: doc.takeNumber, notify, layout: rewriteLayout, focus: id => void rewriteFocus(id) });
  const productRemake = useProductRemake({ canvasId: canvas.id, nodes: doc.nodes, setNodes: doc.setNodes, setEdges: doc.setEdges,
    takeNumber: doc.takeNumber, notify, layout: rewriteLayout, focus: id => void rewriteFocus(id) });
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [dropHighlight, setDropHighlight] = useState<string | null>(null);
  const closeMenu = useRef(() => {});
  const [picking, setPicking] = useState<{ resolve: (picked: PickedMedia | null) => void; includeVideo: boolean } | null>(null);

  const pickWork = useCallback((includeVideo = true) => new Promise<PickedMedia | null>((resolve) => setPicking({ resolve, includeVideo })), []);
  const cards = useCards({ setNodes: doc.setNodes, setEdges: doc.setEdges, takeNumber: doc.takeNumber, notify, pickWork,
    onBlankConnect: (source, screen) => {
      closeMenu.current();
      setPending({ source, screen, at: flow.screenToFlowPosition(screen) });
    }
  });
  const history = useGraphHistory({ nodes: doc.nodes, edges: doc.edges }, doc.ready, graph => {
    doc.setNodes(videoRewrite.restore(graph.nodes)); doc.setEdges(graph.edges);
  });
  const stopLocal = useLocalStop(notify);
  const groups = useBoardGroups(doc, notify);
  const actions = useBoardActions(doc, history, () => closeMenu.current(), notify, stopLocal, groups);
  const characters = useBoardCharacters(doc, notify, actions.selectedNodes, groups.clear);
  const altDrag = useAltDrag(doc);
  const menus = useBoardMenus(cards, doc, actions, history, pending, () => setPending(null), groups, characters);
  closeMenu.current = menus.close;
  useJobPolling(doc.nodes, doc.setNodes);
  const localMedia = useLocalMedia({ canvasId: canvas.id, nodes: doc.nodes, setNodes: doc.setNodes, setEdges: doc.setEdges, takeNumber: doc.takeNumber, notify });
  const videoClip = useVideoClip({ canvasId: canvas.id, nodes: doc.nodes, setNodes: doc.setNodes, setEdges: doc.setEdges, notify });
  const captureFrame = useFrameCapture({ setNodes: doc.setNodes, setEdges: doc.setEdges, notify });
  const layers = useLayers({ canvasId: canvas.id, nodes: doc.nodes, setNodes: doc.setNodes, notify });
  const layerNode = layers.openId ? doc.nodes.find(node => node.id === layers.openId) : undefined;

  useEffect(() => {
    if (doc.ready && flow.getNodes().length) void flow.fitView({ padding: 0.2, maxZoom: 1 });
  }, [doc.ready, flow]);
  useEffect(() => {
    const clear = () => setDropHighlight(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); };
  }, []);

  const board = useMemo<BoardApi>(
    () => ({
      openViewer,
      notify,
      localMedia,
      stopLocal,
      videoClip,
      captureFrame,
      openLayers: layers.open,
      videoRewrite,
      productRemake,
      turnPage: cards.turnPage,
      updateCard: cards.updateCard,
      disconnect: cards.disconnect,
      connect: cards.connect,
      send,
      openRefMenu: menus.openRefMenu,
      openNextMenu: menus.openNextMenu
    }),
    [openViewer, notify, localMedia, stopLocal, videoClip, captureFrame, layers.open, videoRewrite, productRemake, cards, send, menus.openRefMenu, menus.openNextMenu]
  );

  /** 改写图片卡原位补图；其他落点沿用新建卡。 */
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropHighlight(null);
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const id = dropNodeId(event.clientX, event.clientY);
    const character = event.dataTransfer.getData(CHARACTER_DRAG_TYPE);
    if (character) { void characters.drop(character, at, id); return; }
    void handleCanvasDrop(flow.getNodes(), id, {
      work: event.dataTransfer.getData(WORK_DRAG_TYPE), files: Array.from(event.dataTransfer.files)
    }, at, { ...cards, notify }, flow.getNodes).catch(error => notify((error as Error).message));
  };

  const clearCanvas = () => {
    const snapshot = { nodes: flow.getNodes(), edges: flow.getEdges() };
    if (!snapshot.nodes.length) {
      notify("这张画布本来就是空的。");
      return;
    }
    void stopLocal(snapshot.nodes.map(n => n.id));
    doc.setNodes([]);
    doc.setEdges([]);
    notify("已清空这张画布。", { label: "撤销", run: () => { doc.setNodes(videoRewrite.restore(snapshot.nodes)); doc.setEdges(snapshot.edges); } }, 10000);
  };

  const showMultiSelection = !groups.selected && shouldShowMultiSelection(doc.nodes.filter((node) => node.selected).length);

  if (doc.loadError) return <div className="stage__message">打不开这张画布：{doc.loadError}</div>;
  if (!doc.ready) return <div className="stage__message">正在打开画布…</div>;

  return (
    <BoardContext.Provider value={board}>
      <ReactFlow<CardNode, Edge>
        {...boardPointerControls}
        {...boardKeyboardControls}
        panActivationKeyCode={videoClip.session ? null : boardPointerControls.panActivationKeyCode}
        className={`board${showMultiSelection ? " board--multi-selection" : ""}${groups.selected ? ' board--group-selected' : ''}`}
        colorMode="dark"
        nodes={doc.nodes.map(node => node.id === dropHighlight && !node.data.jobs.length
          ? { ...node, className: `${node.className ?? ''} rewrite-drop-target` } : node)}
        edges={doc.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={(_event, node) => groups.selectCard(node.id)}
        onSelectionStart={groups.clear}
        onNodesChange={changes => actions.onNodesChange(changes)}
        onEdgesChange={doc.onEdgesChange}
        onConnect={cards.onConnect}
        onConnectStart={() => closeMenu.current()}
        onConnectEnd={cards.onConnectEnd}
        connectOnClick={false}
        connectionDragThreshold={CONNECTION_DRAG_THRESHOLD}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={MAX_ZOOM}
        onDoubleClick={menus.onDoubleClick}
        onNodeDoubleClick={(event, node) => { if (!(event.target instanceof Element && event.target.closest(NOT_FOCUS))) cardFocus(node.id); }}
        onContextMenu={menus.onContextMenu}
        onPaneClick={() => { videoRewrite.close(); productRemake.close(); actions.deselect(); }}
        onClick={actions.onClick}
        onClickCapture={altDrag.onClickCapture}
        onPointerDownCapture={event => {
          altDrag.onPointerDownCapture(event);
          const id = cardAtPointer(event.target, { x: event.clientX, y: event.clientY });
          if (!event.defaultPrevented && id) groups.selectCard(id);
          if (!event.defaultPrevented) actions.onPointerDownCapture(event);
        }}
        onPointerMove={actions.onPointerMove}
        onPointerLeave={actions.onPointerLeave}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropHighlight(rewriteDropHighlight(flow.getNodes(), dropNodeId(event.clientX, event.clientY), {
            types: Array.from(event.dataTransfer.types), items: Array.from(event.dataTransfer.items)
          }));
        }}
        onDragLeave={event => {
          const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.react-flow__node')?.getAttribute('data-id') : null;
          if (next !== dropHighlight) setDropHighlight(null);
        }}
        onDrop={onDrop}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="#2b2b33" bgColor="#0e0e11" />
        <GroupFrames nodes={doc.nodes} selected={groups.selected} onPointerDown={groups.onPointerDown}
          onContextMenu={menus.onContextMenu} onUngroup={groups.ungroup} onArrange={groups.arrange} onAddImage={productRemake.addImage}
          onAddGroup={productRemake.addProduct} onSameAs={productRemake.setSameAs} />
        <Panel position="top-left" className="board__corner">
          <BrandMark />
          <CanvasMenu current={canvas} canvases={props.canvases} onSwitch={props.onSwitch} onCreate={props.onCreate}
            onRename={props.onRename} onDelete={props.onDelete} onClear={clearCanvas} />
        </Panel>
        <Panel position="bottom-left" className="board__corner">
          <button type="button" className={props.worksOpen ? "board__works is-on" : "board__works"} onClick={props.onToggleWorks}>
            作品库
          </button>
          <ZoomControl />
          <ShortcutHelp />
          <BrandCredit />
        </Panel>
        {doc.nodes.length === 0 ? <div className="board__hint">双击空白处添加卡片，或者把图片拖进来</div> : null}
        <PendingConnection pending={pending} nodes={doc.nodes} />
      </ReactFlow>
      {menus.menu ? <PopMenu at={{ x: menus.menu.x, y: menus.menu.y }} items={menus.menu.items} onClose={menus.close} /> : null}
      {actions.pendingRemove ? <Confirm text={stopConfirmText(actions.pendingRemove.count)} okLabel="删除并停止"
        onOk={actions.confirmRemove} onCancel={actions.cancelRemove} /> : null}
      {menus.assetDialog ? <AssetIdDialog value={menus.assetDialog.value} onSave={menus.saveAssetId} onClose={menus.closeAssetDialog} /> : null}
      {characters.images ? <SaveCharacterDialog images={characters.images} busy={characters.busy} error={characters.error}
        onSave={fields => void characters.save(fields)} onClose={characters.closeSave} /> : null}
      {layerNode ? <LayerEditor node={layerNode} nodes={doc.nodes} onClose={layers.close} split={layers.split} merge={layers.merge}
        redraw={layers.redraw} redrawn={layers.redrawn} /> : null}
      {picking ? (
        <WorksPicker
          includeVideo={picking.includeVideo}
          onPick={(work) => {
            picking.resolve(work);
            setPicking(null);
          }}
        />
      ) : null}
    </BoardContext.Provider>
  );
}
