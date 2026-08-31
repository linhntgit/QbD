import React, { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from '../services/plotlyCustom';

interface PlotlyChartProps {
  data: any[];
  layout: any;
  config?: any;
  style?: React.CSSProperties;
  className?: string;
}

const SCIENTIFIC_FONT = 'Arial, Helvetica, sans-serif';
const INK = '#1f2937';

const DEFAULT_CONFIG = {
  responsive: true,
  displayModeBar: 'hover',
  displaylogo: false,
  scrollZoom: true, // Kích hoạt phóng to / thu nhỏ bằng cuộn chuột và pinch-to-zoom cho đồ thị 3D và 2D
  doubleClick: 'reset+autosize',
  toImageButtonOptions: { format: 'svg', filename: 'qbd-figure', scale: 3 },
};

const SCALE_TRACE_TYPES = new Set([
  'surface',
  'contour',
  'heatmap',
  'histogram2d',
  'histogram2dcontour',
  'mesh3d',
  'cone',
  'streamtube',
]);

const wrapPlotlyText = (value: string, maxLineLength: number) => {
  if (!value || value.includes('<br>') || value.length <= maxLineLength) return value;
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxLineLength) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines.join('<br>');
};

const mergeTitle = (title: any, size: number, maxLineLength?: number) => {
  if (!title) return title;
  if (typeof title === 'string') {
    return {
      text: maxLineLength ? wrapPlotlyText(title, maxLineLength) : title,
      font: { family: SCIENTIFIC_FONT, size, color: INK },
    };
  }
  return {
    ...title,
    text: maxLineLength && typeof title.text === 'string' ? wrapPlotlyText(title.text, maxLineLength) : title.text,
    font: { ...(title.font || {}), family: SCIENTIFIC_FONT, size: title.font?.size ?? size, color: title.font?.color || INK },
  };
};

const scientificAxis = (axis: any = {}, compact = false) => {
  // Nếu trục được chỉ định ẩn (như đồ thị tam giác hoặc custom simplex) thì giữ nguyên, không vẽ tick mồ côi
  const isHidden = axis.visible === false || (axis.showticklabels === false && axis.showline === false);
  if (isHidden) {
    return {
      ...axis,
      showline: axis.showline ?? false,
      showgrid: axis.showgrid ?? false,
      zeroline: axis.zeroline ?? false,
      ticks: axis.ticks ?? '',
      showticklabels: axis.showticklabels ?? false,
      title: axis.title ? mergeTitle(axis.title, compact ? 11 : 13) : undefined,
    };
  }

  return {
    showline: axis.showline ?? true,
    linewidth: axis.linewidth ?? 1,
    linecolor: axis.linecolor ?? '#475569',
    gridcolor: axis.gridcolor ?? '#e2e8f0',
    zerolinecolor: axis.zerolinecolor ?? '#cbd5e1',
    ticks: axis.ticks ?? 'outside',
    ticklen: axis.ticklen ?? 5,
    tickcolor: axis.tickcolor ?? '#475569',
    tickfont: {
      ...(axis.tickfont || {}),
      family: SCIENTIFIC_FONT,
      size: compact ? Math.max(9, (axis.tickfont?.size ?? 11) - 1.5) : axis.tickfont?.size ?? 11,
      color: axis.tickfont?.color || INK,
    },
    automargin: axis.automargin ?? true,
    ...axis,
    title: mergeTitle(axis.title, compact ? 11 : 13),
  };
};

const scientificSceneAxis = (axis: any = {}, compact = false) => ({
  showbackground: axis.showbackground ?? false,
  showline: axis.showline ?? true,
  linewidth: axis.linewidth ?? 1,
  linecolor: axis.linecolor ?? '#64748b',
  gridcolor: axis.gridcolor ?? '#dbe3ec',
  zerolinecolor: axis.zerolinecolor ?? '#cbd5e1',
  ticks: axis.ticks ?? 'outside',
  tickfont: {
    ...(axis.tickfont || {}),
    family: SCIENTIFIC_FONT,
    size: compact ? 9 : axis.tickfont?.size ?? 10,
    color: axis.tickfont?.color || INK,
  },
  ...axis,
  title: mergeTitle(axis.title, compact ? 10.5 : 12, compact ? 28 : 40),
});

const traceHasColorbar = (trace: any) => {
  if (trace.showscale === false) return false;
  return Boolean(
    trace.colorbar || trace.marker?.colorbar || trace.line?.colorbar || SCALE_TRACE_TYPES.has(trace.type)
  );
};

const styleColorbar = (colorbar: any = {}, compact = false) => ({
  ...colorbar,
  x: compact ? 1.01 : 1.02,
  xanchor: 'left',
  y: 0.5,
  yanchor: 'middle',
  len: Math.min(colorbar.len ?? (compact ? 0.82 : 0.86), 0.88),
  thickness: compact ? Math.min(colorbar.thickness ?? 14, 14) : colorbar.thickness ?? 16,
  thicknessmode: colorbar.thicknessmode ?? 'pixels',
  outlinecolor: '#475569',
  outlinewidth: 1,
  tickfont: {
    ...(colorbar.tickfont || {}),
    family: SCIENTIFIC_FONT,
    size: compact ? 9 : colorbar.tickfont?.size ?? 10.5,
    color: colorbar.tickfont?.color || INK,
  },
  title: mergeTitle(colorbar.title, compact ? 9.5 : 11, compact ? 26 : 40),
  bgcolor: 'rgba(255,255,255,0.96)',
  xpad: 8,
});

const normaliseTrace = (trace: any, compact = false) => {
  const namedTrace = compact && typeof trace.name === 'string'
    ? { ...trace, name: wrapPlotlyText(trace.name, 30) }
    : trace;
  if (!traceHasColorbar(namedTrace)) return namedTrace;
  if (namedTrace.colorbar || SCALE_TRACE_TYPES.has(namedTrace.type)) {
    return { ...namedTrace, colorbar: styleColorbar(namedTrace.colorbar, compact) };
  }
  if (namedTrace.marker?.colorbar) {
    return { ...namedTrace, marker: { ...namedTrace.marker, colorbar: styleColorbar(namedTrace.marker.colorbar, compact) } };
  }
  if (namedTrace.line?.colorbar) {
    return { ...namedTrace, line: { ...namedTrace.line, colorbar: styleColorbar(namedTrace.line.colorbar, compact) } };
  }
  return namedTrace;
};

const hasVisibleLegend = (data: any[], layout: any) =>
  layout.showlegend !== false && data.some((trace) => trace.name && trace.showlegend !== false);

function normaliseChart(data: any[], layout: any, compact = false) {
  const hasColorbar = data.some(traceHasColorbar);
  const showLegend = hasVisibleLegend(data, layout);
  const margin = layout.margin || {};
  const scene = layout.scene;
  const is3D = Boolean(scene);
  const isTernary = layout.yaxis?.scaleanchor === 'x' || (layout.xaxis?.showticklabels === false && layout.yaxis?.showticklabels === false);
  const isSmallChart = (layout.height && layout.height <= 250) || (margin.t !== undefined && margin.t <= 20 && !layout.title);

  // Tính lề thông minh theo loại đồ thị để tối ưu không gian hiển thị
  let computedMargin = {
    l: Math.max(margin.l ?? 0, compact ? 60 : 75),
    r: Math.max(margin.r ?? 0, hasColorbar ? (compact ? 90 : 115) : compact ? 25 : 35),
    t: Math.max(margin.t ?? 0, showLegend ? (compact ? 85 : 80) : compact ? 55 : 65),
    b: Math.max(margin.b ?? 0, compact ? 55 : 68),
    pad: Math.max(margin.pad ?? 0, compact ? 2 : 4),
  };

  if (isSmallChart) {
    // Đồ thị dạng profiler / grid nhỏ: giữ nguyên lề nhỏ của người gọi để tối đa hoá diện tích vẽ đường cong
    computedMargin = {
      l: margin.l ?? (compact ? 45 : 55),
      r: margin.r ?? 10,
      t: margin.t ?? 10,
      b: margin.b ?? (compact ? 28 : 34),
      pad: margin.pad ?? 1,
    };
  } else if (is3D) {
    computedMargin = {
      l: Math.max(margin.l ?? 0, compact ? 25 : 35),
      r: Math.max(margin.r ?? 0, hasColorbar ? (compact ? 70 : 85) : compact ? 20 : 35),
      t: Math.max(margin.t ?? 0, showLegend ? (compact ? 92 : 88) : compact ? 50 : 60),
      b: Math.max(margin.b ?? 0, compact ? 30 : 40),
      pad: Math.max(margin.pad ?? 0, 2),
    };
  } else if (isTernary) {
    computedMargin = {
      l: Math.max(margin.l ?? 0, compact ? 25 : 35),
      r: Math.max(margin.r ?? 0, hasColorbar ? (compact ? 75 : 95) : compact ? 20 : 35),
      t: Math.max(margin.t ?? 0, showLegend ? (compact ? 88 : 84) : compact ? 65 : 75),
      b: Math.max(margin.b ?? 0, compact ? 55 : 65),
      pad: Math.max(margin.pad ?? 0, 2),
    };
  }

  const normalisedLayout: any = {
    ...layout,
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { ...(layout.font || {}), family: SCIENTIFIC_FONT, size: layout.font?.size ?? 12, color: layout.font?.color || INK },
    hoverlabel: {
      ...(layout.hoverlabel || {}),
      bgcolor: '#ffffff',
      bordercolor: '#475569',
      font: { ...(layout.hoverlabel?.font || {}), family: SCIENTIFIC_FONT, size: layout.hoverlabel?.font?.size ?? 11, color: layout.hoverlabel?.font?.color || INK },
    },
    margin: computedMargin,
    title: layout.title
      ? {
          ...mergeTitle(layout.title, compact ? 13 : 15, compact ? 45 : 75),
          x: hasColorbar ? (compact ? 0.44 : 0.46) : 0.5,
          xanchor: 'center',
          y: 0.99,
          yanchor: 'top',
          pad: { t: 2, b: 4, ...(typeof layout.title === 'object' ? layout.title?.pad || {} : {}) },
        }
      : undefined,
    legend: showLegend
      ? {
          bgcolor: 'rgba(255,255,255,0.94)',
          bordercolor: '#cbd5e1',
          borderwidth: 1,
          tracegroupgap: compact ? 4 : 8,
          ...(layout.legend || {}),
          orientation: layout.legend?.orientation || 'h',
          x: layout.legend?.x ?? (hasColorbar ? (compact ? 0.44 : 0.46) : 0.5),
          xanchor: layout.legend?.xanchor || 'center',
          y: layout.legend?.y ?? (layout.title ? (compact ? 0.91 : 0.92) : 0.99),
          yanchor: layout.legend?.yanchor || 'top',
          font: {
            family: SCIENTIFIC_FONT,
            size: compact ? 9.5 : 10.5,
            color: INK,
            ...(layout.legend?.font || {}),
          },
        }
      : layout.legend,
  };

  if (Array.isArray(layout.annotations)) {
    normalisedLayout.annotations = layout.annotations.map((ann: any) => ({
      ...ann,
      font: {
        ...(ann.font || {}),
        family: SCIENTIFIC_FONT,
        size: compact ? Math.max(9.5, (ann.font?.size ?? 11) - 1) : ann.font?.size ?? 11,
        color: ann.font?.color || INK,
      },
    }));
  }

  Object.entries(layout).forEach(([key, value]) => {
    if (/^[xy]axis\d*$/.test(key)) normalisedLayout[key] = scientificAxis(value, compact);
  });

  if (scene) {
    normalisedLayout.scene = {
      ...scene,
      domain: {
        ...(scene.domain || {}),
        x: hasColorbar ? [0, compact ? 0.82 : 0.86] : (scene.domain?.x || [0, 1]),
        y: showLegend ? [0, compact ? 0.82 : 0.84] : (scene.domain?.y || [0, 0.92]),
      },
      aspectmode: scene.aspectmode || 'cube',
      xaxis: scientificSceneAxis(scene.xaxis, compact),
      yaxis: scientificSceneAxis(scene.yaxis, compact),
      zaxis: scientificSceneAxis(scene.zaxis, compact),
    };
  }

  return { data: data.map((trace) => normaliseTrace(trace, compact)), layout: normalisedLayout };
}

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  data,
  layout,
  config,
  style = { width: '100%', height: '100%' },
  className = 'scientific-plot',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const compact = config?.compact === true || (containerWidth > 0 && containerWidth < 760);
  const chart = useMemo(() => normaliseChart(data, layout, compact), [data, layout, compact]);
  const chartConfig = useMemo(
    () => {
      const { compact: _compact, ...plotlyConfig } = config || {};
      return {
        ...DEFAULT_CONFIG,
        ...plotlyConfig,
        toImageButtonOptions: { ...DEFAULT_CONFIG.toImageButtonOptions, ...(plotlyConfig.toImageButtonOptions || {}) },
      };
    },
    [config]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    Plotly.react(containerRef.current, chart.data, chart.layout, chartConfig);
  }, [chart, chartConfig]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const resizeChart = (width: number) => {
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        setContainerWidth((current) => Math.abs(current - width) >= 2 ? width : current);
        if (containerRef.current) Plotly.Plots.resize(containerRef.current);
      });
    };

    resizeChart(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) resizeChart(width);
    });
    observer.observe(element);

    // Kích hoạt thêm resize sau khi kết thúc animation CSS (sidebar toggle transition)
    const transitionTimer = window.setTimeout(() => {
      if (containerRef.current) {
        resizeChart(containerRef.current.getBoundingClientRect().width);
      }
    }, 320);

    return () => {
      window.clearTimeout(transitionTimer);
      observer.disconnect();
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
      Plotly.purge(element);
    };
  }, []);

  return <div ref={containerRef} style={{ minWidth: 0, ...style }} className={className} />;
};
