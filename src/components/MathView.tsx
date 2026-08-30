import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathProps {
  math: string;
  className?: string;
  style?: React.CSSProperties;
}

export const InlineMath: React.FC<MathProps> = ({ math, className, style }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(math, {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return math;
    }
  }, [math]);

  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        margin: '0 0.15rem',
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export const BlockMath: React.FC<MathProps> = ({ math, className, style }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(math, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      return math;
    }
  }, [math]);

  return (
    <div
      className={className}
      style={{
        margin: '0.45rem 0',
        padding: '0.55rem 0.85rem',
        backgroundColor: '#f8fafc',
        borderRadius: '0.4rem',
        border: '1px solid #e2e8f0',
        textAlign: 'center',
        overflowX: 'auto',
        fontSize: '0.92rem',
        color: '#1e3a8a',
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
