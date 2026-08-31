import React, { useMemo } from 'react';
import { CornerDownRight, Plus, Trash2, Image, FileCode } from 'lucide-react';
import { saveAs } from 'file-saver';
import type { FishboneCause, FishboneDiagram as FishboneDiagramData } from '../types/qbd';

interface FishboneDiagramProps {
  diagram: FishboneDiagramData;
  onChange: (diagram: FishboneDiagramData) => void;
}

type Side = 'top' | 'bottom';

interface CauseNode {
  categoryId: string;
  cause: FishboneCause;
  level: number;
  source: { x: number; y: number };
  end: { x: number; y: number };
  input: { x: number; y: number };
}

interface CategoryGeometry {
  id: string;
  name: string;
  colour: string;
  side: Side;
  attachment: { x: number; y: number };
  endpoint: { x: number; y: number };
  title: { x: number; y: number };
  causes: CauseNode[];
}

const FONT = "Inter, 'Segoe UI', Arial, sans-serif";
const PALETTE = ['#2563eb', '#0f766e', '#b45309', '#7c3aed', '#475569', '#0369a1', '#be123c', '#15803d'];
const DISPLAY_SCALE = 0.62;
const SPINE_Y = 480;
const MAX_CAUSES_PER_BRANCH = 10;
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const updateCauseTree = (causes: FishboneCause[], causeId: string, update: (cause: FishboneCause) => FishboneCause): FishboneCause[] =>
  causes.map((cause) => cause.id === causeId
    ? update(cause)
    : { ...cause, children: cause.children ? updateCauseTree(cause.children, causeId, update) : undefined });

const removeCauseTree = (causes: FishboneCause[], causeId: string): FishboneCause[] =>
  causes
    .filter((cause) => cause.id !== causeId)
    .map((cause) => ({ ...cause, children: cause.children ? removeCauseTree(cause.children, causeId) : undefined }));

const appendChild = (causes: FishboneCause[], parentId: string, child: FishboneCause): FishboneCause[] =>
  causes.map((cause) => cause.id === parentId
    ? { ...cause, children: [...(cause.children ?? []), child] }
    : { ...cause, children: cause.children ? appendChild(cause.children, parentId, child) : undefined });

const findCause = (causes: FishboneCause[], causeId: string): FishboneCause | undefined => {
  for (const cause of causes) {
    if (cause.id === causeId) return cause;
    const found = cause.children ? findCause(cause.children, causeId) : undefined;
    if (found) return found;
  }
  return undefined;
};

/** A clean, editable Ishikawa canvas. Labels are connected to real bones, not cards. */
export const FishboneDiagram: React.FC<FishboneDiagramProps> = ({ diagram, onChange }) => {
  const fontScale = Math.min(1.35, Math.max(0.8, diagram.fontScale ?? 1));
  const changeFontScale = (delta: number) => onChange({
    ...diagram,
    fontScale: Number(Math.min(1.35, Math.max(0.8, fontScale + delta)).toFixed(2)),
  });
  const geometry = useMemo<CategoryGeometry[]>(() => {
    const categoriesBySide = {
      top: diagram.categories.filter((_, index) => index % 2 === 0),
      bottom: diagram.categories.filter((_, index) => index % 2 === 1),
    };

    const build = (categories: typeof diagram.categories, side: Side): CategoryGeometry[] => categories.map((category, index) => {
      const attachment = {
        x: categories.length === 1 ? 700 : 400 + (index * 600) / (categories.length - 1),
        y: SPINE_Y,
      };
      const endpoint = { x: attachment.x - 145, y: side === 'top' ? 120 : 840 };
      const direction = side === 'top' ? -1 : 1;
      const nodes: CauseNode[] = [];
      const addNodes = (causes: FishboneCause[], source: { x: number; y: number }, level: number) => {
        causes.forEach((cause, causeIndex) => {
          const fraction = level === 0
            ? causes.length === 1 ? 0.6 : 0.1 + (causeIndex * 0.82) / (causes.length - 1)
            : 1;
          const anchor = level === 0
            ? { x: endpoint.x + (attachment.x - endpoint.x) * fraction, y: endpoint.y + (attachment.y - endpoint.y) * fraction }
            : { x: source.x + causeIndex * 16, y: source.y + direction * causeIndex * 34 };
          // Every minor bone uses the same direction vector, yielding clean
          // parallel strokes while the anchors are distributed along the parent.
          const end = { x: anchor.x - (level === 0 ? 72 : 48), y: anchor.y + direction * (level === 0 ? 36 : 24) };
          nodes.push({ categoryId: category.id, cause, level, source: anchor, end, input: { x: end.x - 170, y: end.y - 16 } });
          if (cause.children?.length) addNodes(cause.children, end, level + 1);
        });
      };
      addNodes(category.causes, endpoint, 0);
      return {
        id: category.id,
        name: category.name,
        colour: PALETTE[diagram.categories.findIndex((item) => item.id === category.id) % PALETTE.length],
        side,
        attachment,
        endpoint,
        title: { x: endpoint.x - 95, y: side === 'top' ? 34 : 925 },
        causes: nodes,
      };
    });
    return [...build(categoriesBySide.top, 'top'), ...build(categoriesBySide.bottom, 'bottom')];
  }, [diagram]);

  const updateCategory = (categoryId: string, update: Partial<FishboneDiagramData['categories'][number]>) => onChange({
    ...diagram,
    categories: diagram.categories.map((category) => category.id === categoryId ? { ...category, ...update } : category),
  });

  const updateCause = (categoryId: string, causeId: string, text: string) => {
    const category = diagram.categories.find((item) => item.id === categoryId);
    if (category) updateCategory(categoryId, { causes: updateCauseTree(category.causes, causeId, (cause) => ({ ...cause, text })) });
  };

  const addCause = (categoryId: string, parentId?: string) => {
    const category = diagram.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const siblings = parentId ? findCause(category.causes, parentId)?.children ?? [] : category.causes;
    if (siblings.length >= MAX_CAUSES_PER_BRANCH) return;
    const child = { id: makeId('cause'), text: parentId ? 'Nguyên nhân cấp tiếp theo' : 'Nguyên nhân cần xem xét' };
    updateCategory(categoryId, { causes: parentId ? appendChild(category.causes, parentId, child) : [...category.causes, child] });
  };

  const canAddCause = (categoryId: string, parentId?: string): boolean => {
    const category = diagram.categories.find((item) => item.id === categoryId);
    if (!category) return false;
    return (parentId ? findCause(category.causes, parentId)?.children ?? [] : category.causes).length < MAX_CAUSES_PER_BRANCH;
  };

  const removeCause = (categoryId: string, causeId: string) => {
    const category = diagram.categories.find((item) => item.id === categoryId);
    if (category) updateCategory(categoryId, { causes: removeCauseTree(category.causes, causeId) });
  };

  const addCategory = () => {
    if (diagram.categories.length >= 8) return;
    onChange({ ...diagram, categories: [...diagram.categories, { id: makeId('category'), name: 'NHÓM NGUYÊN NHÂN', causes: [{ id: makeId('cause'), text: 'Nguyên nhân cần xem xét' }] }] });
  };

  // Helper to generate a standalone, self-contained SVG XML string for export
  const generateExportSVG = () => {
    const escapeXML = (str: string) =>
      str.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case "'": return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });

    const categoryBoxes = geometry.map((branch) => {
      const titleX = branch.title.x;
      const titleY = branch.title.y;
      const boxW = 220;
      const boxH = 46;
      const fontSize = Math.round(13 * fontScale);
      const lines = branch.name.split('\n');

      const branchBox = `
        <g>
          <rect x="${titleX}" y="${titleY}" width="${boxW}" height="${boxH}" rx="5" fill="#ffffff" stroke="${branch.colour}" stroke-width="1.5" />
          <rect x="${titleX}" y="${titleY + boxH - 4}" width="${boxW}" height="4" rx="2" fill="${branch.colour}" />
          <text x="${titleX + boxW / 2}" y="${titleY + (lines.length > 1 ? 18 : 28)}" text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="800" fill="${branch.colour}">
            ${lines.map((l, i) => `<tspan x="${titleX + boxW / 2}" dy="${i === 0 ? 0 : 16}">${escapeXML(l)}</tspan>`).join('')}
          </text>
        </g>
      `;

      const causeBoxes = branch.causes.map((c) => {
        const boxW = Math.max(118, 165 - c.level * 12);
        const boxH = 38;
        const fontSize = Math.round((c.level === 0 ? 12 : 11) * fontScale);
        const textLines = c.cause.text.split('\n');

        return `
          <g>
            <rect x="${c.input.x}" y="${c.input.y}" width="${boxW}" height="${boxH}" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="1" />
            <text x="${c.input.x + 8}" y="${c.input.y + (textLines.length > 1 ? 15 : 23)}" font-family="${FONT}" font-size="${fontSize}" font-weight="${c.level === 0 ? '600' : '500'}" fill="#1e293b">
              ${textLines.map((l, i) => `<tspan x="${c.input.x + 8}" dy="${i === 0 ? 0 : 14}">${escapeXML(l)}</tspan>`).join('')}
            </text>
          </g>
        `;
      }).join('\n');

      return branchBox + '\n' + causeBoxes;
    }).join('\n');

    const effectFontSize = Math.round(14 * fontScale);
    const effectLines = diagram.effect.split('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000" viewBox="0 0 1500 1000">
  <defs>
    <marker id="ishikawa-arrow" markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto">
      <path d="M0,0 L0,8 L11,4 z" fill="#334155" />
    </marker>
  </defs>
  <rect width="1500" height="1000" fill="#ffffff" />
  
  <!-- Header / Title -->
  <text x="50" y="55" font-family="${FONT}" font-size="20" font-weight="800" fill="#0f172a">SƠ ĐỒ NGUYÊN NHÂN - KẾT QUẢ ISHIKAWA (FISHBONE DIAGRAM)</text>
  <text x="50" y="82" font-family="${FONT}" font-size="13" font-weight="500" fill="#64748b">Phân tích rủi ro tiền định và sàng lọc nguyên nhân chất lượng (ICH Q9 Quality Risk Management)</text>
  
  <!-- Spine & Main Skeleton -->
  <path d="M95 ${SPINE_Y} L1220 ${SPINE_Y}" stroke="#334155" stroke-width="5" stroke-linecap="round" marker-end="url(#ishikawa-arrow)" />
  <path d="M95 ${SPINE_Y} L146 431 M95 ${SPINE_Y} L146 529 M95 ${SPINE_Y} L37 ${SPINE_Y}" stroke="#64748b" stroke-width="3.5" stroke-linecap="round" />
  
  <!-- Category Bones & Cause Connectors -->
  ${geometry.map((branch) => `
    <g>
      <path d="M${branch.endpoint.x} ${branch.endpoint.y} L${branch.attachment.x} ${branch.attachment.y}" stroke="${branch.colour}" stroke-width="3.5" stroke-linecap="round" />
      <circle cx="${branch.attachment.x}" cy="${branch.attachment.y}" r="5.5" fill="${branch.colour}" />
      ${branch.causes.map((cause) => `<path d="M${cause.source.x} ${cause.source.y} L${cause.end.x} ${cause.end.y}" stroke="${branch.colour}" stroke-width="${cause.level === 0 ? '2.2' : '1.7'}" stroke-linecap="round" opacity="${cause.level === 0 ? 0.85 : 0.65}" />`).join('\n')}
    </g>
  `).join('\n')}
  
  <!-- Fish Head -->
  <path d="M1210 360 Q1350 360 1472 480 Q1350 600 1210 600 Z" fill="#103f67" stroke="#082f49" stroke-width="2.5" />
  <circle cx="1422" cy="435" r="6.5" fill="#ffffff" />
  <circle cx="1424" cy="435" r="2.7" fill="#0f172a" />
  
  <!-- Effect Text in Head -->
  <g>
    <rect x="1225" y="420" width="200" height="120" rx="6" fill="#082f49" fill-opacity="0.4" stroke="#7dd3fc" stroke-width="1.2" />
    <text x="1325" y="${420 + (effectLines.length > 2 ? 35 : 45)}" text-anchor="middle" font-family="${FONT}" font-size="${effectFontSize}" font-weight="700" fill="#ffffff">
      ${effectLines.map((l, i) => `<tspan x="1325" dy="${i === 0 ? 0 : 20}">${escapeXML(l)}</tspan>`).join('')}
    </text>
  </g>

  <!-- Branch & Cause Labels -->
  ${categoryBoxes}

  <!-- Footer Watermark -->
  <text x="750" y="975" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="600" fill="#94a3b8">© QbD Studio™ — Tran Linh Nguyen • ICH Q8/Q9 Ishikawa Risk Assessment</text>
</svg>`;
  };

  const handleExportSVG = () => {
    const svgStr = generateExportSVG();
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    saveAs(blob, `Ishikawa_Diagram_${Date.now()}.svg`);
  };

  const handleExportPNG = () => {
    const svgStr = generateExportSVG();
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new globalThis.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2; // 2x Retina resolution (3000 x 2000 px)
      canvas.width = 1500 * scale;
      canvas.height = 1000 * scale;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            saveAs(blob, `Ishikawa_Diagram_${Date.now()}.png`);
          }
          URL.revokeObjectURL(url);
        }, 'image/png');
      }
    };
    img.src = url;
  };

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Sơ đồ Ishikawa</h3>
          <p style={{ margin: '0.2rem 0 0', color: '#64748b', fontSize: '0.76rem' }}>Nhấp vào chữ để sửa; <strong>↳</strong> tạo nhánh con của một nguyên nhân.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', color: '#475569', fontWeight: 700 }}>Cỡ chữ</span>
          <button type="button" className="btn btn-secondary" onClick={() => changeFontScale(-0.1)} disabled={fontScale <= 0.8} title="Giảm cỡ chữ" style={{ minWidth: 30, padding: '0.3rem 0.45rem' }}>A−</button>
          <span className="font-mono" style={{ minWidth: 38, textAlign: 'center', fontSize: '0.72rem', color: '#334155' }}>{Math.round(fontScale * 100)}%</span>
          <button type="button" className="btn btn-secondary" onClick={() => changeFontScale(0.1)} disabled={fontScale >= 1.35} title="Tăng cỡ chữ" style={{ minWidth: 30, padding: '0.3rem 0.45rem' }}>A+</button>
          <button className="btn btn-secondary" onClick={addCategory} disabled={diagram.categories.length >= 8} style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem' }}><Plus size={14} /> Thêm nhánh chính</button>
          
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportSVG}
            title="Xuất sơ đồ ra file vector SVG sắc nét vô hạn"
            style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem', color: '#0f766e', borderColor: '#99f6e4' }}
          >
            <FileCode size={14} />
            <span>Xuất SVG</span>
          </button>
          
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportPNG}
            title="Xuất sơ đồ ra file ảnh PNG độ nét cao 3000x2000px"
            style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem', color: '#1e3a8a', borderColor: '#bfdbfe' }}
          >
            <Image size={14} />
            <span>Xuất PNG</span>
          </button>
        </div>
      </div>

      <div style={{ border: '1px solid #dbe4ef', borderRadius: '0.75rem', background: '#fcfdff', overflow: 'hidden' }}>
        <div style={{ width: '100%', maxWidth: 930, height: 620, margin: '0 auto', position: 'relative' }}>
          <div style={{ width: 1500, height: 1000, position: 'absolute', top: 0, left: 0, transform: `scale(${DISPLAY_SCALE})`, transformOrigin: 'top left' }}>
          <svg aria-hidden="true" width="1500" height="1000" viewBox="0 0 1500 1000" style={{ position: 'absolute', inset: 0 }}>
            <defs><marker id="ishikawa-arrow" markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto"><path d="M0,0 L0,8 L11,4 z" fill="#334155" /></marker></defs>
            <path d={`M95 ${SPINE_Y} L1220 ${SPINE_Y}`} stroke="#334155" strokeWidth="5" strokeLinecap="round" markerEnd="url(#ishikawa-arrow)" />
            <path d={`M95 ${SPINE_Y} L146 431 M95 ${SPINE_Y} L146 529 M95 ${SPINE_Y} L37 ${SPINE_Y}`} stroke="#64748b" strokeWidth="3.5" strokeLinecap="round" />
            {geometry.map((branch) => <g key={branch.id}>
              <path d={`M${branch.endpoint.x} ${branch.endpoint.y} L${branch.attachment.x} ${branch.attachment.y}`} stroke={branch.colour} strokeWidth="3.5" strokeLinecap="round" />
              <circle cx={branch.attachment.x} cy={branch.attachment.y} r="5.5" fill={branch.colour} />
              {branch.causes.map((cause) => <path key={cause.cause.id} d={`M${cause.source.x} ${cause.source.y} L${cause.end.x} ${cause.end.y}`} stroke={branch.colour} strokeWidth={cause.level === 0 ? '2.2' : '1.7'} strokeLinecap="round" opacity={cause.level === 0 ? 0.85 : 0.65} />)}
            </g>)}
            <path d="M1210 360 Q1350 360 1472 480 Q1350 600 1210 600 Z" fill="#103f67" stroke="#082f49" strokeWidth="2.5" />
            <circle cx="1422" cy="435" r="6.5" fill="#ffffff" /><circle cx="1424" cy="435" r="2.7" fill="#0f172a" />
          </svg>

          {geometry.map((branch) => <React.Fragment key={branch.id}>
            <div style={{ position: 'absolute', left: branch.title.x, top: branch.title.y, width: 220, display: 'flex', alignItems: 'center', gap: 3 }}>
              <textarea aria-label="Tên nhánh chính" spellCheck={false} value={branch.name} onChange={(event) => updateCategory(branch.id, { name: event.target.value })} rows={2} style={{ fontFamily: FONT, fontSize: `${0.76 * fontScale}rem`, fontWeight: 800, letterSpacing: '0.02em', flex: 1, minWidth: 0, minHeight: 42, padding: '0.34rem 0.45rem', color: branch.colour, background: '#ffffff', border: `1px solid ${branch.colour}55`, borderBottom: `3px solid ${branch.colour}`, borderRadius: 5, outline: 'none', resize: 'none', overflowY: 'auto', overflowWrap: 'anywhere', lineHeight: 1.2 }} />
              <button title={`Thêm nguyên nhân (tối đa ${MAX_CAUSES_PER_BRANCH})`} aria-label="Thêm nguyên nhân" disabled={!canAddCause(branch.id)} onClick={() => addCause(branch.id)} style={{ border: `1px solid ${branch.colour}55`, color: branch.colour, background: '#ffffff', borderRadius: 5, cursor: 'pointer', width: 26, height: 26, display: 'grid', placeItems: 'center', opacity: canAddCause(branch.id) ? 1 : 0.4 }}><Plus size={14} /></button>
              <button title="Xóa nhánh" aria-label="Xóa nhánh" onClick={() => onChange({ ...diagram, categories: diagram.categories.filter((category) => category.id !== branch.id) })} disabled={diagram.categories.length <= 1} style={{ border: 'none', color: '#dc2626', background: 'transparent', cursor: 'pointer', padding: 3 }}><Trash2 size={14} /></button>
            </div>
            {branch.causes.map((cause) => <div key={cause.cause.id} style={{ position: 'absolute', left: cause.input.x, top: cause.input.y, width: Math.max(118, 165 - cause.level * 12), display: 'flex', gap: 2, alignItems: 'center' }}>
              {cause.level > 0 && <CornerDownRight size={12} color={branch.colour} strokeWidth={2.2} />}
              <textarea aria-label={`Nguyên nhân: ${cause.cause.text}`} spellCheck={false} value={cause.cause.text} onChange={(event) => updateCause(branch.id, cause.cause.id, event.target.value)} rows={2} style={{ fontFamily: FONT, fontSize: `${(cause.level === 0 ? 0.74 : 0.69) * fontScale}rem`, fontWeight: cause.level === 0 ? 600 : 500, minWidth: 0, flex: 1, minHeight: 38, padding: '0.25rem 0.35rem', color: '#1e293b', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 4, outline: 'none', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)', resize: 'none', overflowY: 'auto', overflowWrap: 'anywhere', lineHeight: 1.2 }} />
              <button title={`Thêm nhánh con (tối đa ${MAX_CAUSES_PER_BRANCH})`} aria-label="Thêm nhánh con" disabled={!canAddCause(branch.id, cause.cause.id)} onClick={() => addCause(branch.id, cause.cause.id)} style={{ border: 'none', color: branch.colour, background: 'transparent', cursor: 'pointer', padding: 1, opacity: canAddCause(branch.id, cause.cause.id) ? 1 : 0.4 }}><CornerDownRight size={13} /></button>
              <button title="Xóa nguyên nhân" aria-label="Xóa nguyên nhân" onClick={() => removeCause(branch.id, cause.cause.id)} style={{ border: 'none', color: '#94a3b8', background: 'transparent', cursor: 'pointer', padding: 1 }}><Trash2 size={11} /></button>
            </div>)}
          </React.Fragment>)}

          <div style={{ position: 'absolute', left: 1238, top: 434, width: 188, textAlign: 'center' }}>
            <textarea aria-label="Vấn đề" spellCheck={false} value={diagram.effect} onChange={(event) => onChange({ ...diagram, effect: event.target.value })} rows={4} style={{ fontFamily: FONT, width: '100%', resize: 'none', color: '#ffffff', background: 'rgba(8, 47, 73, 0.35)', border: '1px solid #7dd3fc', borderRadius: 5, padding: '6px 7px', textAlign: 'center', fontSize: `${0.76 * fontScale}rem`, fontWeight: 700, lineHeight: 1.25, outline: 'none', overflowY: 'auto', overflowWrap: 'anywhere' }} />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
