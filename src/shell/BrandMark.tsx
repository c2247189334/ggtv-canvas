/** G 的方块字形，照用户 10-31 给的 GG 标志描的；两个 G 一模一样，第二个平移 448。 */
const G = "M180 460L248 390L541 390L604 455L604 492L305 492L276 522L276 773L306 800L468 800L468 679L327 679L327 572L536 572L586 627L586 838L519 902L248 902L180 836Z";
const T = "M1180 410L1200 390L1560 390L1580 410L1580 492L1430 492L1430 882L1410 902L1350 902L1330 882L1330 492L1180 492Z";
const V = "M1620 390L1720 390L1840 770L1960 390L2060 390L2060 420L1900 902L1780 902L1620 420Z";

/** 左上「GG TV」标志：作者名片，只展示不能点。去掉原 logo 的外圈和碎片，TV 照同样切角补画（用户 10-31 定）。 */
export function BrandMark() {
  return (
    <div className="brand-mark" role="img" aria-label="GG TV">
      <svg viewBox="170 380 1900 532" width="57" height="16" aria-hidden="true">
        <path d={G} />
        <path d={G} transform="translate(448 0)" />
        <path d={T} />
        <path d={V} />
      </svg>
    </div>
  );
}
