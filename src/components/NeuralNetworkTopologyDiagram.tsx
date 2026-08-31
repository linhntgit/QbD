import React, { useMemo } from 'react';
import type { Factor, CQA, NeuralNetConfig, NeuralTrainingMode, NeuralArchitectureMetrics } from '../types/qbd';

interface NeuralNetworkTopologyDiagramProps {
  factors: Factor[];
  cqas: CQA[];
  selectedCQA: string;
  config: NeuralNetConfig;
  trainingMode?: NeuralTrainingMode;
  archMetrics?: NeuralArchitectureMetrics;
  isTraining?: boolean;
  trainingProgress?: {
    tour: number;
    totalTours: number;
    epoch: number;
    maxEpochs: number;
    phase?: string;
  } | null;
}

function getNodeYs(count: number, topPadding: number, usableHeight: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [topPadding + usableHeight / 2];
  const spacing = usableHeight / (count - 1);
  const maxSpacing = 52;
  if (spacing > maxSpacing) {
    const totalSpan = (count - 1) * maxSpacing;
    const startY = topPadding + (usableHeight - totalSpan) / 2;
    return Array.from({ length: count }, (_, index) => startY + index * maxSpacing);
  }
  return Array.from({ length: count }, (_, index) => topPadding + index * spacing);
}

export const NeuralNetworkTopologyDiagram: React.FC<NeuralNetworkTopologyDiagramProps> = ({
  factors,
  cqas,
  selectedCQA,
  config,
  trainingMode = 'independent',
  archMetrics,
  isTraining = false,
  trainingProgress,
}) => {
  const activeFactors = useMemo(
    () => factors.filter((f) => f.controllability !== 'constant'),
    [factors]
  );

  const isShared = trainingMode === 'shared';
  const currentCQA = cqas.find((c) => c.code === selectedCQA) || cqas[0];
  const outputCQAs = isShared ? cqas : currentCQA ? [currentCQA] : [];

  // Helper to safely truncate text if it exceeds max length
  const truncateText = (str: string, maxLen: number) => {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
  };

  const numInputs = activeFactors.length;
  const numH1 = config.hiddenNodes1 || 3;
  const numH2 = config.hiddenNodes2 || 0;
  const numOutputs = outputCQAs.length;

  const hasH2 = numH2 > 0;
  const maxNodesInLayer = Math.max(numInputs, numH1, numH2, numOutputs, 3);

  // SVG Canvas dimensions with generous width to prevent text clipping on left/right
  const svgWidth = 1180;
  const svgHeight = Math.max(300, maxNodesInLayer * 52 + 80);
  const topPadding = 52;
  const bottomPadding = 32;
  const usableHeight = svgHeight - topPadding - bottomPadding;

  // Column X positions (255px left margin for input labels, 320px right margin for output labels)
  const xInput = 255;
  const xH1 = hasH2 ? 500 : 580;
  const xH2 = hasH2 ? 675 : 0;
  const xOutput = 855;

  const inputYs = useMemo(() => getNodeYs(numInputs, topPadding, usableHeight), [numInputs, topPadding, usableHeight]);
  const h1Ys = useMemo(() => getNodeYs(numH1, topPadding, usableHeight), [numH1, topPadding, usableHeight]);
  const h2Ys = useMemo(() => getNodeYs(numH2, topPadding, usableHeight), [numH2, topPadding, usableHeight]);
  const outputYs = useMemo(() => getNodeYs(numOutputs, topPadding, usableHeight), [numOutputs, topPadding, usableHeight]);

  const getFactorColor = (f: Factor) => {
    if (f.role === 'mixture_component' || f.type === 'Mixture') return '#0d9488'; // Teal
    if (f.role === 'formulation_other') return '#2563eb'; // Blue
    return '#d97706'; // Amber for Process
  };

  const getFactorRoleBadge = (f: Factor) => {
    if (f.role === 'mixture_component' || f.type === 'Mixture') return 'Hỗn hợp';
    if (f.role === 'formulation_other') return 'Công thức';
    return 'Quy trình';
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '0.625rem',
        padding: '1rem',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
      }}
    >
      {/* Header Info Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '0.75rem',
          paddingBottom: '0.6rem',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#7c3aed',
              boxShadow: '0 0 0 3px rgba(124, 58, 237, 0.2)',
            }}
          />
          <span style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a' }}>
            SƠ ĐỒ TRỰC QUAN KIẾN TRÚC MẠNG NƠ-RON (MLP TOPOLOGY)
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: '0.76rem',
              fontWeight: '700',
              color: '#7c3aed',
              backgroundColor: '#ede9fe',
              padding: '0.15rem 0.5rem',
              borderRadius: '4px',
            }}
          >
            [{numInputs} Inputs] ➔ [{numH1} H1]{hasH2 ? ` ➔ [${numH2} H2]` : ''} ➔ [{numOutputs} Output{numOutputs > 1 ? 's' : ''}]
          </span>
          {isTraining && trainingProgress && (
            <span
              className="badge"
              style={{
                backgroundColor: '#7c3aed',
                color: '#ffffff',
                fontSize: '0.72rem',
                fontWeight: '700',
                padding: '0.2rem 0.55rem',
                borderRadius: '4px',
                animation: 'pulse 1.5s infinite',
              }}
            >
              ⚡ Đang huấn luyện: Tour #{trainingProgress.tour}/{trainingProgress.totalTours} · Epoch {trainingProgress.epoch}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.76rem' }}>
          <span
            className="badge"
            style={{
              backgroundColor: isShared ? '#0284c7' : '#0f766e',
              color: '#ffffff',
              padding: '0.2rem 0.55rem',
            }}
          >
            {isShared ? '🌐 Mô hình Hợp Nhất (Fit All Y)' : `🎯 Mô hình Độc Lập (${currentCQA?.code || 'Single Y'})`}
          </span>
          <span
            className="badge"
            style={{
              backgroundColor: '#f1f5f9',
              color: '#475569',
              border: '1px solid #cbd5e1',
              padding: '0.2rem 0.5rem',
            }}
          >
            Hàm Kích Hoạt: <strong>{config.activation.toUpperCase()}</strong>
          </span>
          {archMetrics && (
            <span
              className="badge"
              style={{
                backgroundColor: '#faf5ff',
                color: '#6b21a8',
                border: '1px solid #e9d5ff',
                padding: '0.2rem 0.5rem',
              }}
            >
              Tổng trọng số: <strong>{archMetrics.totalParameters}</strong> (W + b)
            </span>
          )}
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{
            width: '100%',
            height: 'auto',
            minWidth: '780px',
            display: 'block',
            backgroundColor: '#f8fafc',
            borderRadius: '0.5rem',
            border: '1px solid #e2e8f0',
          }}
        >
          <defs>
            {/* Gradients */}
            <linearGradient id="synapseGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.45" />
            </linearGradient>
            <linearGradient id="synapseGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#6b21a8" stopOpacity="0.45" />
            </linearGradient>
            <linearGradient id="synapseGradOut" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#0f766e" stopOpacity="0.5" />
            </linearGradient>
          </defs>

          {/* Layer Background Column Panels */}
          {/* Input Layer Column Header */}
          <g>
            <rect x="15" y="8" width={xInput - 10} height="28" rx="5" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1" />
            <text x={(15 + xInput - 10) / 2} y="26" textAnchor="middle" fill="#334155" fontSize="11" fontWeight="700">
              LỚP ĐẦU VÀO ({numInputs} Biến X)
            </text>
          </g>

          {/* Hidden Layer 1 Header */}
          <g>
            <rect x={xH1 - 65} y="8" width="130" height="28" rx="5" fill="#ede9fe" stroke="#c4b5fd" strokeWidth="1" />
            <text x={xH1} y="26" textAnchor="middle" fill="#6b21a8" fontSize="11" fontWeight="700">
              LỚP ẨN 1 ({numH1} Nơ-ron)
            </text>
          </g>

          {/* Hidden Layer 2 Header (if present) */}
          {hasH2 && (
            <g>
              <rect x={xH2 - 65} y="8" width="130" height="28" rx="5" fill="#fae8ff" stroke="#e879f9" strokeWidth="1" />
              <text x={xH2} y="26" textAnchor="middle" fill="#86198f" fontSize="11" fontWeight="700">
                LỚP ẨN 2 ({numH2} Nơ-ron)
              </text>
            </g>
          )}

          {/* Output Layer Header */}
          <g>
            <rect x={xOutput - 30} y="8" width={svgWidth - xOutput + 15} height="28" rx="5" fill="#ccfbf1" stroke="#99f6e4" strokeWidth="1" />
            <text x={(xOutput - 30 + svgWidth - 15) / 2} y="26" textAnchor="middle" fill="#0f766e" fontSize="11" fontWeight="700">
              LỚP ĐẦU RA ({isShared ? `${numOutputs} CQAs Hợp nhất` : `${numOutputs} CQA Độc lập`})
            </text>
          </g>

          {/* ================= SYNAPTIC CONNECTIONS (WIRES) ================= */}
          {/* 1. Input -> H1 */}
          {inputYs.map((yIn, iIdx) =>
            h1Ys.map((yH1, hIdx) => {
              const dx = xH1 - xInput;
              return (
                <path
                  key={`syn-in-h1-${iIdx}-${hIdx}`}
                  d={`M ${xInput} ${yIn} C ${xInput + dx * 0.45} ${yIn}, ${xH1 - dx * 0.45} ${yH1}, ${xH1} ${yH1}`}
                  fill="none"
                  stroke="url(#synapseGrad1)"
                  strokeWidth={isTraining ? '1.8' : '1.1'}
                  className={isTraining ? 'neural-synapse-pulsing' : undefined}
                />
              );
            })
          )}

          {/* 2. H1 -> H2 (if present) */}
          {hasH2 &&
            h1Ys.map((yH1, h1Idx) =>
              h2Ys.map((yH2, h2Idx) => {
                const dx = xH2 - xH1;
                return (
                  <path
                    key={`syn-h1-h2-${h1Idx}-${h2Idx}`}
                    d={`M ${xH1} ${yH1} C ${xH1 + dx * 0.45} ${yH1}, ${xH2 - dx * 0.45} ${yH2}, ${xH2} ${yH2}`}
                    fill="none"
                    stroke="url(#synapseGrad2)"
                    strokeWidth={isTraining ? '1.8' : '1.1'}
                    className={isTraining ? 'neural-synapse-pulsing' : undefined}
                  />
                );
              })
            )}

          {/* 3. (H1 or H2) -> Output */}
          {hasH2
            ? h2Ys.map((yH2, h2Idx) =>
                outputYs.map((yOut, oIdx) => {
                  const dx = xOutput - xH2;
                  return (
                    <path
                      key={`syn-h2-out-${h2Idx}-${oIdx}`}
                      d={`M ${xH2} ${yH2} C ${xH2 + dx * 0.45} ${yH2}, ${xOutput - dx * 0.45} ${yOut}, ${xOutput} ${yOut}`}
                      fill="none"
                      stroke="url(#synapseGradOut)"
                      strokeWidth={isTraining ? '1.9' : '1.2'}
                      className={isTraining ? 'neural-synapse-pulsing' : undefined}
                    />
                  );
                })
              )
            : h1Ys.map((yH1, h1Idx) =>
                outputYs.map((yOut, oIdx) => {
                  const dx = xOutput - xH1;
                  return (
                    <path
                      key={`syn-h1-out-${h1Idx}-${oIdx}`}
                      d={`M ${xH1} ${yH1} C ${xH1 + dx * 0.45} ${yH1}, ${xOutput - dx * 0.45} ${yOut}, ${xOutput} ${yOut}`}
                      fill="none"
                      stroke="url(#synapseGradOut)"
                      strokeWidth={isTraining ? '1.9' : '1.2'}
                      className={isTraining ? 'neural-synapse-pulsing' : undefined}
                    />
                  );
                })
              )}

          {/* ================= LAYER NODES ================= */}

          {/* 1. INPUT LAYER NODES */}
          {activeFactors.map((factor, idx) => {
            const y = inputYs[idx];
            const color = getFactorColor(factor);
            const roleBadge = getFactorRoleBadge(factor);

            return (
              <g key={`input-node-${factor.code}`}>
                {/* Node Label on Left */}
                <text
                  x={xInput - 22}
                  y={y - 4}
                  textAnchor="end"
                  fill="#0f172a"
                  fontSize="11"
                  fontWeight="700"
                >
                  {factor.code}: {truncateText(factor.name, 30)}
                </text>
                <text
                  x={xInput - 22}
                  y={y + 10}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="9.5"
                >
                  [{factor.unit || '-'}] • <tspan fill={color} fontWeight="600">{roleBadge}</tspan>
                </text>

                {/* Animated Pulsing Ring when Training */}
                {isTraining && (
                  <circle
                    cx={xInput}
                    cy={y}
                    r="14"
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    className="neural-node-ring"
                  />
                )}

                {/* Outer Glow */}
                <circle cx={xInput} cy={y} r="16" fill={color} fillOpacity="0.15" />
                {/* Circle Node */}
                <circle cx={xInput} cy={y} r="12" fill={color} stroke="#ffffff" strokeWidth="2" />
                {/* Text inside node */}
                <text
                  x={xInput}
                  y={y + 3.5}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="9.5"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {factor.code}
                </text>
              </g>
            );
          })}

          {/* 2. HIDDEN LAYER 1 NODES */}
          {h1Ys.map((y, idx) => (
            <g key={`h1-node-${idx}`}>
              {/* Animated Pulsing Ring when Training */}
              {isTraining && (
                <circle
                  cx={xH1}
                  cy={y}
                  r="14"
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth="2"
                  className="neural-node-ring"
                />
              )}
              {/* Outer Glow */}
              <circle cx={xH1} cy={y} r="17" fill="#7c3aed" fillOpacity="0.15" />
              {/* Circle Node */}
              <circle cx={xH1} cy={y} r="13" fill="#7c3aed" stroke="#ffffff" strokeWidth="2" />
              {/* Text inside node */}
              <text
                x={xH1}
                y={y + 3.5}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="9"
                fontWeight="bold"
                fontFamily="monospace"
              >
                h{idx + 1}
              </text>
              {/* Activation Function Tooltip label */}
              <text
                x={xH1}
                y={y + 24}
                textAnchor="middle"
                fill="#6b21a8"
                fontSize="8"
                fontWeight="600"
              >
                {config.activation}
              </text>
            </g>
          ))}

          {/* 3. HIDDEN LAYER 2 NODES (if present) */}
          {hasH2 &&
            h2Ys.map((y, idx) => (
              <g key={`h2-node-${idx}`}>
                {/* Animated Pulsing Ring when Training */}
                {isTraining && (
                  <circle
                    cx={xH2}
                    cy={y}
                    r="14"
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth="2"
                    className="neural-node-ring"
                  />
                )}
                {/* Outer Glow */}
                <circle cx={xH2} cy={y} r="17" fill="#6b21a8" fillOpacity="0.15" />
                {/* Circle Node */}
                <circle cx={xH2} cy={y} r="13" fill="#6b21a8" stroke="#ffffff" strokeWidth="2" />
                {/* Text inside node */}
                <text
                  x={xH2}
                  y={y + 3.5}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  h{idx + 1}
                </text>
                <text
                  x={xH2}
                  y={y + 24}
                  textAnchor="middle"
                  fill="#581c87"
                  fontSize="8"
                  fontWeight="600"
                >
                  {config.activation}
                </text>
              </g>
            ))}

          {/* 4. OUTPUT LAYER NODES */}
          {outputCQAs.map((cqa, idx) => {
            const y = outputYs[idx];
            const isTarget = !isShared || cqa.code === selectedCQA;

            return (
              <g key={`out-node-${cqa.code}`}>
                {/* Animated Pulsing Ring when Training */}
                {isTraining && (
                  <circle
                    cx={xOutput}
                    cy={y}
                    r="14"
                    fill="none"
                    stroke="#0d9488"
                    strokeWidth="2"
                    className="neural-node-ring"
                  />
                )}
                {/* Outer Glow */}
                <circle cx={xOutput} cy={y} r="17" fill="#0f766e" fillOpacity="0.18" />
                {/* Circle Node */}
                <circle cx={xOutput} cy={y} r="13" fill="#0f766e" stroke="#ffffff" strokeWidth="2" />
                {/* Text inside node */}
                <text
                  x={xOutput}
                  y={y + 3.5}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="9.5"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {cqa.code}
                </text>


                {/* Node Label on Right */}
                <text
                  x={xOutput + 24}
                  y={y - 4}
                  textAnchor="start"
                  fill="#0f172a"
                  fontSize="11"
                  fontWeight="700"
                >
                  {cqa.code}: {truncateText(cqa.name, 32)}
                  {isTarget && isShared && <tspan fill="#0284c7" fontWeight="600"> (Active)</tspan>}
                </text>
                <text
                  x={xOutput + 24}
                  y={y + 10}
                  textAnchor="start"
                  fill="#0f766e"
                  fontSize="9.5"
                  fontWeight="600"
                >
                  [{cqa.unit || '-'}] • Goal: {cqa.objective.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginTop: '0.65rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid #f1f5f9',
          fontSize: '0.74rem',
          color: '#64748b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0d9488', display: 'inline-block' }} />
            <span>Biến hỗn hợp (Σ=100%)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#2563eb', display: 'inline-block' }} />
            <span>Biến công thức khác</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#d97706', display: 'inline-block' }} />
            <span>Biến quy trình</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#7c3aed', display: 'inline-block' }} />
            <span>Nơ-ron ẩn ({config.activation.toUpperCase()})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0f766e', display: 'inline-block' }} />
            <span>Chỉ tiêu đầu ra (CQA)</span>
          </div>
        </div>

        <div>
          <span>Đường nét: </span>
          <strong style={{ color: '#0f172a' }}>Trọng số liên kết Synapses ($W, b$)</strong>
        </div>
      </div>
    </div>
  );
};
