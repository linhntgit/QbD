import React, { useEffect, useRef } from 'react';
// @ts-ignore
import Plotly from 'plotly.js-dist-min';

interface PlotlyChartProps {
  data: any[];
  layout: any;
  config?: any;
  style?: React.CSSProperties;
  className?: string;
}

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  data,
  layout,
  config = { responsive: true, displayModeBar: true, displaylogo: false },
  style = { width: '100%', height: '100%' },
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    Plotly.react(containerRef.current, data, layout, config);

    const handleResize = () => {
      if (containerRef.current) {
        Plotly.Plots.resize(containerRef.current);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [data, layout, config]);

  return <div ref={containerRef} style={style} className={className} />;
};
