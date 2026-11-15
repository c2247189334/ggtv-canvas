import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { newAudioCard, newCard, newVideoCard } from "@/domain/cards";
import type { CardNode } from "@/types";
import { PromptPanel } from "./PromptPanel";

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as { source: string; target: string; id: string }[], ruleIssues: [] as string[] }));
vi.mock('./useRewritePromptCheck', () => ({ useRewritePromptCheck: () => graph.ruleIssues }));
vi.mock("@xyflow/react", () => ({ useEdges: () => graph.edges, useNodes: () => graph.nodes,
  useReactFlow: () => ({ getNode: (id: string) => graph.nodes.find(node => node.id === id), getNodes: () => graph.nodes, getEdges: () => graph.edges }) }));
vi.mock("@/canvas/boardContext", () => ({ useBoard: () => ({ updateCard: vi.fn(), startRefPick: vi.fn(), disconnect: vi.fn(), send: vi.fn() }) }));
vi.mock("@/api", () => ({ api: { health: vi.fn() } }));

describe("共享提示词面板", () => {
  it('拆解中的新视频即使手填提示词也禁发，写词按钮说明等待铺图', () => {
    graph.nodes = []; graph.edges = []; graph.ruleIssues = [];
    const html = renderToStaticMarkup(<PromptPanel id="pending" data={{ ...newVideoCard('generate', 1),
      rewriteId: 'r', rewriteSourceId: 's', rewriteBusy: 'analyzing', rewriteStatus: { status: 'pending' }, prompt: '手填词' }} />);
    // 11-04 面板理顺：等待只说一次、不算出错，写词按钮和「＋参考」同一排；11-08 用户定：灰字收进「N 条提醒 ?」，平时藏着。
    expect(html.match(/>正在拆解视频，图片卡铺好后再补图</g)).toHaveLength(1);
    expect(html).toMatch(/class="panel__tools">.*aria-label="1 条提醒，提醒".*hidden=""><span class="help-tip__line">正在拆解视频，图片卡铺好后再补图<\/span>/);
    expect(html).not.toContain('panel__hint');
    expect(html).toMatch(/class="gen__send" disabled=""/);
    expect(html).toMatch(/disabled=""[^>]*>生成提示词/);
    expect(html).toMatch(/class="panel__tools">(?:(?!<\/div>).)*>生成提示词（免费）<\/button>/);
  });
  it('改写卡有生成提示词按钮，旧卡说明缺拆解结果；普通卡不显示', () => {
    graph.nodes = []; graph.edges = []; graph.ruleIssues = [];
    const html = renderToStaticMarkup(<PromptPanel id="rewrite" data={{ ...newVideoCard('generate', 1), rewriteId: 'old' }} />);
    expect(html).toContain('生成提示词');
    expect(html).toContain('<span class="help-tip__line">这张卡是旧版做的，没存拆解结果，请重新做一次视频改写</span>');
    expect(html).toMatch(/disabled=""[^>]*>生成提示词/);
    // 11-08 用户定：改写卡只留「生成提示词」一步，不放「帮我改写」和「让 Claude 看一遍」；普通卡照旧有「帮我改写」。
    expect(html).not.toContain('帮我改写'); expect(html).not.toContain('看一遍');
    const ordinary = renderToStaticMarkup(<PromptPanel id="ordinary" data={newVideoCard('generate', 1)} />);
    expect(ordinary).not.toContain('生成提示词'); expect(ordinary).toContain('帮我改写');
  });
  it('改写视频卡面板加宽；生成提示词后输入框加高；普通卡和空词照旧（用户 10-30）', () => {
    graph.nodes = []; graph.edges = []; graph.ruleIssues = [];
    const rewrite = { ...newVideoCard('generate', 1), rewriteId: 'r' };
    const empty = renderToStaticMarkup(<PromptPanel id="r" data={rewrite} />);
    expect(empty).toContain('class="panel panel--rewrite '); expect(empty).not.toContain('panel__prompt--long');
    expect(renderToStaticMarkup(<PromptPanel id="r" data={{ ...rewrite, prompt: '@图片1是场景。' }} />)).toContain('class="panel__prompt panel__prompt--long"');
    const ordinary = renderToStaticMarkup(<PromptPanel id="o" data={{ ...newVideoCard('generate', 1), prompt: '跳舞' }} />);
    expect(ordinary).not.toContain('panel--rewrite'); expect(ordinary).not.toContain('panel__prompt--long');
  });
  it('拆解提醒收进「?」（鼠标移上去才看），不作为规则错误禁发', () => {
    graph.nodes = []; graph.edges = []; graph.ruleIssues = [];
    const html = renderToStaticMarkup(<PromptPanel id="target" data={{ ...newVideoCard('generate', 1),
      rewriteWarnings: ['深度可能把短裙拉长'], prompt: '人物站立' }} />);
    expect(html).toContain('<span class="help-tip__line">深度可能把短裙拉长</span>');
    expect(html).not.toContain('panel__error'); expect(html).not.toMatch(/class="gen__send" disabled/);
  });
  it('免费规则问题标红并禁发，不能只显示提醒', () => {
    graph.nodes = []; graph.edges = []; graph.ruleIssues = ['时间轴中间断开'];
    const data = { ...newVideoCard('generate', 1), rewriteId: 'gone', prompt: '0-1秒跳舞。3-5秒走路。' };
    const html = renderToStaticMarkup(<PromptPanel id="target" data={data} />);
    expect(html).toContain('时间轴中间断开');
    expect(html).toMatch(/class="gen__send" disabled=""/);
    graph.ruleIssues = [];
  });
  it('11-08 出错合并、收进单独的出错区（可滚动），在发送那一行上面；灰字提醒在上面那排「?」里', () => {
    const duty = (tag: string) => `${tag}的素材职责要放在时间轴前，请在第一个时间区间前写明它采用什么、不采用什么。`;
    graph.nodes = []; graph.edges = [];
    graph.ruleIssues = [duty('@图片1'), duty('@图片2'), '@图片1还写着原视频的原描述「金发」，请删掉这段。', duty('@视频1')];
    const html = renderToStaticMarkup(<PromptPanel id="target" data={{ ...newVideoCard('generate', 1), rewriteId: 'r', prompt: '0-5秒跳舞。',
      rewriteWarnings: ['深度可能把短裙拉长'] }} />);
    expect(html.match(/素材职责要放在时间轴前/g)).toHaveLength(1);
    expect(html).toContain('>@图片1、@图片2、@视频1的素材职责要放在时间轴前');
    expect(html).toContain('原描述「金发」');
    const notes = html.indexOf('class="panel__notes"');
    expect(notes).toBeGreaterThan(html.indexOf('class="panel__prompt'));
    expect(html.indexOf('深度可能把短裙拉长')).toBeLessThan(html.indexOf('class="panel__prompt'));
    expect(html.indexOf('深度可能把短裙拉长')).toBeGreaterThan(html.indexOf('class="help-tip"'));
    expect(html.indexOf('素材职责')).toBeGreaterThan(notes);
    expect(html).not.toMatch(/panel__error">深度可能把短裙拉长/);
    expect(html.indexOf('class="gen"')).toBeGreaterThan(html.indexOf('素材职责'));
    expect(html).toMatch(/class="gen__send" disabled=""/);
    graph.ruleIssues = [];
    const clean = renderToStaticMarkup(<PromptPanel id="o" data={{ ...newVideoCard('generate', 1), prompt: '跳舞' }} />);
    expect(clean).not.toContain('panel__notes'); expect(clean).not.toContain('help-tip');
  });
  it("图片卡仍显示原占位字、张数和图片模型", () => {
    graph.nodes = []; graph.edges = [];
    const html = renderToStaticMarkup(<PromptPanel id="image" data={newCard("generate", 1)} />);
    expect(html).toContain("描述你想要的画面；要改图就先点「＋参考」接一张图");
    expect(html).toContain("Seedream 5.0 Flash");
    expect(html).toContain("1张");
    expect(html).not.toContain("文生视频");
    expect(html).toContain('disabled="">帮我改写</button>'); expect(html).not.toContain('¥');
  });
  it("图片、视频分别编号，按原线序标红，未出结果的视频保留种类", () => {
    graph.nodes = [
      { id: "a", type: "card", position: { x: 0, y: 0 }, data: newCard("upload", 1, [{ type: "upload", id: "image" }]) },
      { id: "b", type: "card", position: { x: 0, y: 0 }, data: newVideoCard("upload", 2, [{ type: "upload", id: "video", media: "video", seconds: 5 }]) },
      { id: "c", type: "card", position: { x: 0, y: 0 }, data: newVideoCard("generate", 3) }
    ];
    graph.edges = graph.nodes.map(node => ({ id: node.id, source: node.id, target: "target" }));
    const data = { ...newVideoCard("generate", 4), blocked: [2] };
    const html = renderToStaticMarkup(<PromptPanel id="target" data={data} />);
    expect(html).toContain("@图片1");
    expect(html).toContain("@视频1");
    expect(html).toContain("@视频2");
    expect(html.match(/is-blocked/g)).toHaveLength(1);
    expect(html).toContain("被拦");
    expect(html).toContain("▶ 0:05");
    expect(html).toContain("还没视频");
    expect(html).toContain("每段参考视频要在 2 到 15 秒之间。");
    expect(html).toContain("正在检查参考视频的存储设置…");
    expect(html).toMatch(/class="gen__send" disabled=""/);
    expect(html).toContain("描述你想要生成的画面内容，@引用素材");
  });
  it("非空提示词可改写，声音卡不显示生成面板", () => {
    graph.nodes = []; graph.edges = [];
    const html = renderToStaticMarkup(<PromptPanel id="image" data={{ ...newCard("generate", 1), prompt: "猫" }} />);
    expect(html).toContain('<button type="button">帮我改写</button>'); expect(html).not.toContain('¥');
    expect(renderToStaticMarkup(<PromptPanel id="audio" data={newAudioCard("work", 2)} />)).toBe("");
  });
  it("音频引用有音符和时长，三种素材独立编号，标红仍按原线序", () => {
    graph.nodes = [
      { id: "a", type: "card", position: { x: 0, y: 0 }, data: newVideoCard("work", 1, [{ type: "work", id: "video", media: "video", seconds: 5 }]) },
      { id: "b", type: "card", position: { x: 0, y: 0 }, data: newAudioCard("extracted", 2, [{ type: "work", id: "audio", media: "audio", seconds: 2 }]) },
      { id: "c", type: "card", position: { x: 0, y: 0 }, data: newCard("upload", 3, [{ type: "upload", id: "image" }]) }
    ];
    graph.edges = graph.nodes.map(node => ({ id: node.id, source: node.id, target: "target" }));
    const html = renderToStaticMarkup(<PromptPanel id="target" data={{ ...newVideoCard("generate", 4), blocked: [2] }} />);
    expect(html).toContain("@图片1"); expect(html).toContain("@视频1"); expect(html).toContain("@音频1");
    expect(html).toContain("♪ 0:02"); expect(html).toContain("断开这段参考音频");
    expect(html.match(/is-blocked/g)).toHaveLength(1);
    expect(html).not.toContain('src="/api/works/file?id=audio"');
  });
  it("改写视频的未引用素材在发送前标红，普通视频保持原检查", () => {
    graph.nodes = [{ id: "a", type: "card", position: { x: 0, y: 0 },
      data: newAudioCard("extracted", 1, [{ type: "work", id: "a", media: "audio", seconds: 6 }]) }];
    graph.edges = [{ id: "a-target", source: "a", target: "target" }];
    const data = { ...newVideoCard("generate", 2), rewriteId: "r", prompt: "一位人物" };
    const html = renderToStaticMarkup(<PromptPanel id="target" data={data} />);
    expect(html).toContain("@音频1 没在提示词里");
    expect(html).toMatch(/class="gen__send" disabled=""/);
    const ordinary = renderToStaticMarkup(<PromptPanel id="target" data={{ ...data, rewriteId: undefined }} />);
    expect(ordinary).not.toContain("@音频1 没在提示词里");
  });
});
