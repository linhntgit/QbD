import React, { useEffect, useMemo, useRef } from 'react';
// @ts-ignore
import Plotly from 'plotly.js-dist-min';

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
  displayModeBar: true,
  displaylogo: false,
  scrollZoom: false,
  doubleClick: 'reset+autosize',
  toImageButtonOptions: { format: 'svg', filename: 'qbd-figure', scale: 2 },
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

const mergeTitle = (title: any, size: number) => {
  if (!title) return title;
  if (typeof title === 'string') return { text: title, font: { family: SCIENTIFIC_FONT, size, color: INK } };
  return {
    ...title,
    font: { ...(title.font || {}), family: SCIENTIFIC_FONT, size, color: title.font?.color || INK },
  };
};

const scientificAxis = (axis: any = {}) => ({
  showline: true,
  linewidth: 1,
  linecolor: '#475569',
  gridcolor: '#e2e8f0',
  zerolinecolor: '#cbd5e1',
  ticks: 'outside',
  ticklen: 5,
  tickcolor: '#475569',
  tickfont: { ...(axis.tickfont || {}), family: SCIENTIFIC_FONT, size: axis.tickfont?.size ?? 11, color: axis.tickfont?.color || INK },
  automargin: true,
  ...axis,
  title: mergeTitle(axis.title, 13),
});

const scientificSceneAxis = (axis: any = {}) => ({
  showbackground: false,
  showline: true,
  linewidth: 1,
  linecolor: '#64748b',
  gridcolor: '#dbe3ec',
  zerolinecolor: '#cbd5e1',
  ticks: 'outside',
  tickfont: { ...(axis.tickfont || {}), family: SCIENTIFIC_FONT, size: axis.tickfont?.size ?? 10, color: axis.tickfont?.color || INK },
  ...axis,
  title: mergeTitle(axis.title, 12),
});

const traceHasColorbar = (trace: any) => {
  if (trace.showscale === false) return false;
  return Boolean(
    trace.colorbar || trace.marker?.colorbar || trace.line?.colorbar || SCALE_TRACE_TYPES.has(trace.type)
  );
};

const styleColorbar = (colorbar: any = {}) => ({
  ...colorbar,
  x: 1.02,
  xanchor: 'left',
  y: 0.5,
  yanchor: 'middle',
  len: Math.min(colorbar.len ?? 0.76, 0.78),
  thickness: colorbar.thickness ?? 15,
  thicknessmode: colorbar.thicknessmode ?? 'pixels',
  outlinecolor: '#475569',
  outlinewidth: 1,
  tickfont: { ...(colorbar.tickfont || {}), family: SCIENTIFIC_FONT, size: colorbar.tickfont?.size ?? 10.5, color: colorbar.tickfont?.color || INK },
  title: mergeTitle(colorbar.title, 11),
  bgcolor: 'rgba(255,255,255,0.96)',
  xpad: 8,
});

const normaliseTrace = (trace: any) => {
  if (!traceHasColorbar(trace)) return trace;
  if (trace.colorbar || SCALE_TRACE_TYPES.has(trace.type)) {
    return { ...trace, colorbar: styleColorbar(trace.colorbar) };
  }
  if (trace.marker?.colorbar) {
    return { ...trace, marker: { ...trace.marker, colorbar: styleColorbar(trace.marker.colorbar) } };
  }
  if (trace.line?.colorbar) {
    return { ...trace, line: { ...trace.line, colorbar: styleColorbar(trace.line.colorbar) } };
  }
  return trace;
};

const hasVisibleLegend = (data: any[], layout: any) =>
  layout.showlegend !== false && data.some((trace) => trace.name && trace.showlegend !== false);

function normaliseChart(data: any[], layout: any, compact = false) {
  const hasColorbar = data.some(traceHasColorbar);
  const showLegend = hasVisibleLegend(data, layout);
  const margin = layout.margin || {};
  const scene = layout.scene;

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
    margin: {
      l: Math.max(margin.l ?? 0, compact ? 42 : 72),
      r: Math.max(margin.r ?? 0, hasColorbar ? 180 : compact ? 14 : 48),
      t: Math.max(margin.t ?? 0, compact ? 10 : showLegend ? 108 : 68),
      b: Math.max(margin.b ?? 0, compact ? 30 : 68),
      pad: Math.max(margin.pad ?? 0, compact ? 2 : 8),
    },
    title: mergeTitle(layout.title, 16),
    legend: showLegend
      ? {
          ...(layout.legend || {}),
          orientation: 'h',
          x: 0.5,
          xanchor: 'center',
          y: 1.02,
          yanchor: 'bottom',
          font: { ...(layout.legend?.font || {}), family: SCIENTIFIC_FONT, size: layout.legend?.font?.size ?? 11, color: layout.legend?.font?.color || INK },
          bgcolor: 'rgba(255,255,255,0.96)',
          bordercolor: '#cbd5e1',
          borderwidth: 1,
          tracegroupgap: 8,
        }
      : layout.legend,
  };

  Object.entries(layout).forEach(([key, value]) => {
    if (/^[xy]axis\d*$/.test(key)) normalisedLayout[key] = scientificAxis(value);
  });

  if (scene) {
    normalisedLayout.scene = {
      ...scene,
      domain: hasColorbar ? { ...(scene.domain || {}), x: [0, 0.82] } : scene.domain,
      xaxis: scientificSceneAxis(scene.xaxis),
      yaxis: scientificSceneAxis(scene.yaxis),
      zaxis: scientificSceneAxis(scene.zaxis),
    };
  }

  return { data: data.map(normaliseTrace), layout: normalisedLayout };
}

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  data,
  layout,
  config,
  style = { width: '100%', height: '100%' },
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chart = useMemo(() => normaliseChart(data, layout, config?.compact === true), [data, layout, config?.compact]);
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

    const handleResize = () => {
      if (containerRef.current) Plotly.Plots.resize(containerRef.current);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [chart, chartConfig]);

  return <div ref={containerRef} style={style} className={className} />;
};
