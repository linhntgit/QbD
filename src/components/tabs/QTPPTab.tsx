import React from 'react';
import {
  Plus,
  Trash2,
  Sparkles,
  Sliders,
  Target,
  FlaskConical,
  Lock,
} from 'lucide-react';
import type {
  QBDProject,
  QTPPItem,
  CQA,
  Factor,
  FactorDataType,
  FactorControllability,
  CQADataType,
  CQAObjective,
} from '../../types/qbd';

interface QTPPTabProps {
  project: QBDProject;
  onUpdateProject: (updated: Partial<QBDProject>) => void;
}

const MIN_LEVELS = 2;
const MAX_LEVELS = 10;

interface LevelEditorProps {
  ariaPrefix: string;
  values: string[];
  numeric?: boolean;
  maxLevels?: number;
  onChange: (values: string[]) => void;
}

const LevelEditor: React.FC<LevelEditorProps> = ({ ariaPrefix, values, numeric = false, maxLevels = MAX_LEVELS, onChange }) => {
  const levels = values.length >= MIN_LEVELS ? values.slice(0, maxLevels) : [...values, ...new Array(MIN_LEVELS - values.length).fill('')];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.2rem 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: '0.35rem' }}>
        {levels.map((level, index) => (
          <div key={`${ariaPrefix}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <input
              aria-label={`${ariaPrefix} ${index + 1}`}
              type={numeric ? 'number' : 'text'}
              step={numeric ? 'any' : undefined}
              className="input-field"
              value={level}
              placeholder={`Mức ${index + 1}`}
              onChange={(event) => {
                const next = [...levels];
                next[index] = event.target.value;
                onChange(next);
              }}
            />
            {levels.length > MIN_LEVELS && (
              <button
                type="button"
                aria-label={`Xóa ${ariaPrefix.toLowerCase()} ${index + 1}`}
                title={`Xóa mức ${index + 1}`}
                onClick={() => onChange(levels.filter((_, levelIndex) => levelIndex !== index))}
                style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', padding: '2px' }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={levels.length >= maxLevels}
          onClick={() => onChange([...levels, ''])}
          style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem', opacity: levels.length >= maxLevels ? 0.55 : 1 }}
        >
          <Plus size={12} /> Thêm mức
        </button>
        <span style={{ fontSize: '0.68rem', color: '#64748b', whiteSpace: 'nowrap' }}>{levels.length}/{maxLevels} mức</span>
      </div>
    </div>
  );
};

export const QTPPTab: React.FC<QTPPTabProps> = ({ project, onUpdateProject }) => {
  // 1. QTPP Management
  const handleAddQTPP = () => {
    const newItem: QTPPItem = {
      id: `qtpp-${Date.now()}`,
      element: 'Chỉ tiêu mới (ví dụ: Độ hòa tan, Độ ổn định...)',
      target: 'Tiêu chuẩn mục tiêu',
      justification: 'Căn cứ khoa học / Yêu cầu dược điển',
    };
    onUpdateProject({ qtpp: [...project.qtpp, newItem] });
  };

  const handleUpdateQTPP = (id: string, field: keyof QTPPItem, value: string) => {
    const updated = project.qtpp.map((item) => (item.id === id ? { ...item, [field]: value } : item));
    onUpdateProject({ qtpp: updated });
  };

  const handleDeleteQTPP = (id: string) => {
    onUpdateProject({ qtpp: project.qtpp.filter((item) => item.id !== id) });
  };

  // 2. CQA Management
  const handleAddCQA = () => {
    const nextCode = `Y${project.cqas.length + 1}`;
    const newCQA: CQA = {
      id: `cqa-${Date.now()}`,
      name: `Chỉ tiêu chất lượng ${nextCode}`,
      code: nextCode,
      dataType: 'quantitative',
      unit: '%',
      target: 100,
      lowerLimit: 90,
      upperLimit: 110,
      objective: 'target',
      weight: 3,
      sShape: 1,
      tShape: 1,
    };
    onUpdateProject({ cqas: [...project.cqas, newCQA] });
  };

  const handleUpdateCQA = (id: string, field: keyof CQA, value: any) => {
    const updated = project.cqas.map((cqa) => (cqa.id === id ? { ...cqa, [field]: value } : cqa));
    onUpdateProject({ cqas: updated });
  };

  const handleCQADataTypeChange = (cqa: CQA, dataType: CQADataType) => {
    let categories: string[] | undefined;
    let objective = cqa.objective;
    let targetCategory = cqa.targetCategory;

    if (dataType === 'quantitative_multilevel') {
      categories = cqa.dataType === 'quantitative_multilevel' && cqa.categories?.length
        ? cqa.categories.slice(0, MAX_LEVELS)
        : [cqa.lowerLimit, cqa.target, cqa.upperLimit]
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            .map(String);
      if (categories.length < MIN_LEVELS) categories = ['0', '1', '2'];
      if (objective === 'pass_category') objective = 'target';
      targetCategory = undefined;
    } else if (dataType === 'qualitative_binary') {
      categories = cqa.dataType?.startsWith('qualitative') && cqa.categories?.length
        ? cqa.categories.slice(0, 2)
        : ['Không đạt', 'Đạt'];
      while (categories.length < 2) categories.push(`Mức ${categories.length + 1}`);
      objective = 'pass_category';
      targetCategory = categories[1];
    } else if (dataType === 'qualitative_ordinal') {
      categories = cqa.dataType?.startsWith('qualitative') && cqa.categories?.length
        ? cqa.categories.slice(0, MAX_LEVELS)
        : ['Mức 1', 'Mức 2', 'Mức 3'];
      objective = 'pass_category';
      targetCategory = categories[categories.length - 1];
    } else {
      categories = undefined;
      if (objective === 'pass_category') objective = 'target';
      targetCategory = undefined;
    }

    const updated = project.cqas.map((item) => item.id === cqa.id
      ? { ...item, dataType, categories, objective, targetCategory }
      : item);
    onUpdateProject({ cqas: updated });
  };

  const handleDeleteCQA = (id: string) => {
    onUpdateProject({ cqas: project.cqas.filter((cqa) => cqa.id !== id) });
  };

  // 3. Factor Management
  const handleAddFactor = () => {
    const nextCode = `X${project.factors.length + 1}`;
    const newFactor: Factor = {
      id: `factor-${Date.now()}`,
      name: `Thông số ${nextCode}`,
      code: nextCode,
      type: 'CPP',
      dataType: 'quantitative',
      controllability: 'controllable',
      role: 'process_parameter',
      unit: '°C',
      low: 20,
      high: 80,
      center: 50,
    };
    onUpdateProject({ factors: [...project.factors, newFactor] });
  };

  const handleUpdateFactor = (id: string, field: keyof Factor, value: any) => {
    const updated = project.factors.map((f) => {
      if (f.id !== id) return f;
      const modified = { ...f, [field]: value };
      if (field === 'low' || field === 'high') {
        const l = field === 'low' ? Number(value) : f.low;
        const h = field === 'high' ? Number(value) : f.high;
        modified.center = Number(((l + h) / 2).toFixed(2));
      }
      if (field === 'categories' && f.dataType === 'quantitative_multilevel') {
        const numericLevels = (value as string[])
          .map((level) => level.trim())
          .filter(Boolean)
          .map(Number)
          .filter(Number.isFinite);
        if (numericLevels.length >= MIN_LEVELS) {
          modified.low = Math.min(...numericLevels);
          modified.high = Math.max(...numericLevels);
          modified.center = numericLevels[Math.floor(numericLevels.length / 2)];
        }
      }
      if (field === 'role') {
        if (value === 'mixture_component') {
          modified.type = 'Mixture';
        } else if (value === 'formulation_other') {
          modified.type = 'Formulation';
        } else if (value === 'process_parameter') {
          modified.type = 'CPP';
        }
      }
      return modified;
    });
    onUpdateProject({ factors: updated });
  };

  const handleFactorDataTypeChange = (factor: Factor, dataType: FactorDataType) => {
    let categories: string[] | undefined;
    if (dataType === 'quantitative_multilevel') {
      categories = factor.dataType === 'quantitative_multilevel' && factor.categories?.length
        ? factor.categories.slice(0, MAX_LEVELS)
        : [factor.low, factor.center ?? (factor.low + factor.high) / 2, factor.high].map(String);
    } else if (dataType === 'qualitative') {
      categories = factor.dataType === 'qualitative' && factor.categories?.length
        ? factor.categories.slice(0, MAX_LEVELS)
        : ['Mức 1', 'Mức 2'];
    }

    const updated = project.factors.map((item) => item.id === factor.id
      ? { ...item, dataType, categories }
      : item);
    onUpdateProject({ factors: updated });
  };

  const handleDeleteFactor = (id: string) => {
    onUpdateProject({ factors: project.factors.filter((f) => f.id !== id) });
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Project Metadata Card */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FlaskConical size={20} color="#1e3a8a" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a' }}>
              Thông tin Tổng quan Dự án (Project Metadata)
            </h2>
          </div>
          <span className="badge badge-primary">QbD Framework</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
              Tên Dự án / Nghiên cứu
            </label>
            <input
              type="text"
              className="input-field"
              value={project.name}
              onChange={(e) => onUpdateProject({ name: e.target.value })}
              placeholder="VD: Tối ưu hóa viên nén Metoprolol 100mg"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
              Tên Hoạt chất / Hoạt chất mục tiêu (API)
            </label>
            <input
              type="text"
              className="input-field"
              value={project.moleculeName}
              onChange={(e) => onUpdateProject({ moleculeName: e.target.value })}
              placeholder="VD: Metoprolol Succinate"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
              Dạng bào chế & Đường dùng
            </label>
            <input
              type="text"
              className="input-field"
              value={project.dosageForm}
              onChange={(e) => onUpdateProject({ dosageForm: e.target.value })}
              placeholder="VD: Viên nén giải phóng kéo dài, dùng đường uống"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
              Đơn vị / Nhóm nghiên cứu
            </label>
            <input
              type="text"
              className="input-field"
              value={project.author}
              onChange={(e) => onUpdateProject({ author: e.target.value })}
              placeholder="VD: Phòng Nghiên cứu Phát triển Bào chế"
            />
          </div>
        </div>
      </div>

      {/* 1. QTPP Section (ICH Q8) */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Target size={19} color="#0f766e" />
              <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a' }}>
                1. Hồ sơ Chất lượng Sản phẩm Mục tiêu (QTPP - ICH Q8)
              </h2>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
              Xác định các đặc tính chất lượng của sản phẩm thuốc để đảm bảo độ an toàn và hiệu quả điều trị mong muốn.
            </p>
          </div>
          <button onClick={handleAddQTPP} className="btn btn-teal" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
            <Plus size={15} />
            <span>Thêm Yếu tố QTPP</span>
          </button>
        </div>

        <div className="table-container">
          <table className="qbd-table">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Yếu tố QTPP (Element)</th>
                <th style={{ width: '35%' }}>Mục tiêu Đích (Target)</th>
                <th style={{ width: '30%' }}>Căn cứ Khoa học / Dược điển (Justification)</th>
                <th style={{ width: '5%', textAlign: 'center' }}>Xóa</th>
              </tr>
            </thead>
            <tbody>
              {project.qtpp.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      aria-label={`Yếu tố QTPP ${item.element || item.id}`}
                      type="text"
                      className="input-field"
                      value={item.element}
                      onChange={(e) => handleUpdateQTPP(item.id, 'element', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Mục tiêu QTPP của ${item.element || item.id}`}
                      type="text"
                      className="input-field"
                      value={item.target}
                      onChange={(e) => handleUpdateQTPP(item.id, 'target', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Căn cứ khoa học của ${item.element || item.id}`}
                      type="text"
                      className="input-field"
                      value={item.justification}
                      onChange={(e) => handleUpdateQTPP(item.id, 'justification', e.target.value)}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => handleDeleteQTPP(item.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                      title="Xóa mục này"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. CQAs Section (ICH Q8) - Enhanced with Data Type (Quantitative vs Qualitative) */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={19} color="#1e3a8a" />
              <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a' }}>
                2. Thuộc tính Chất lượng Trọng yếu (CQAs - Biến Đầu Ra)
              </h2>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
              Hỗ trợ cả biến đầu ra Định lượng (Quantitative liên tục/rời rạc) và Định tính (Qualitative Đạt/Không đạt, Xếp hạng).
            </p>
          </div>
          <button onClick={handleAddCQA} className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
            <Plus size={15} />
            <span>Thêm CQA (Đáp ứng Y)</span>
          </button>
        </div>

        <div className="table-container">
          <table className="qbd-table">
            <thead>
              <tr>
                <th style={{ width: '6%' }}>Mã</th>
                <th style={{ width: '22%' }}>Tên CQA (Đáp ứng)</th>
                <th style={{ width: '15%' }}>Bản Chất Dữ Liệu (Data Type)</th>
                <th style={{ width: '7%' }}>Đơn vị</th>
                <th colSpan={3} style={{ width: '33%' }}>Giới hạn định lượng / Các mức cho phép (tối đa 10)</th>
                <th style={{ width: '12%' }}>Mục tiêu Tối ưu</th>
                <th style={{ width: '8%' }}>Trọng số</th>
                <th style={{ width: '4%', textAlign: 'center' }}>Xóa</th>
              </tr>
            </thead>
            <tbody>
              {project.cqas.map((cqa) => (
                <tr key={cqa.id}>
                  <td>
                    <span className="font-mono font-bold" style={{ color: '#1e3a8a', fontWeight: '700' }}>
                      {cqa.code}
                    </span>
                  </td>
                  <td>
                    <input
                      aria-label={`Tên CQA ${cqa.code}`}
                      type="text"
                      className="input-field"
                      value={cqa.name}
                      onChange={(e) => handleUpdateCQA(cqa.id, 'name', e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Kiểu dữ liệu CQA ${cqa.code}`}
                      className="input-field"
                      style={{ fontSize: '0.78rem' }}
                      value={cqa.dataType || 'quantitative'}
                      onChange={(e) => handleCQADataTypeChange(cqa, e.target.value as CQADataType)}
                    >
                      <option value="quantitative">🔢 Continuous (Định lượng liên tục)</option>
                      <option value="quantitative_multilevel">📊 Discrete Numeric (Định lượng nhiều mức)</option>
                      <option value="qualitative_binary">✅ Categorical (Đạt / Không đạt)</option>
                      <option value="qualitative_ordinal">🏷️ Categorical (Nhiều mức / Thứ bậc)</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Đơn vị CQA ${cqa.code}`}
                      type="text"
                      className="input-field"
                      style={{ textAlign: 'center' }}
                      value={cqa.unit}
                      onChange={(e) => handleUpdateCQA(cqa.id, 'unit', e.target.value)}
                    />
                  </td>
                  {cqa.dataType && cqa.dataType !== 'quantitative' ? (
                    <td colSpan={3}>
                      <LevelEditor
                        ariaPrefix={`Mức ${cqa.dataType === 'quantitative_multilevel' ? 'định lượng' : 'định tính'} CQA ${cqa.code}`}
                        numeric={cqa.dataType === 'quantitative_multilevel'}
                        maxLevels={cqa.dataType === 'qualitative_binary' ? 2 : MAX_LEVELS}
                        values={cqa.categories ?? (cqa.dataType === 'qualitative_binary' ? ['Không đạt', 'Đạt'] : ['Mức 1', 'Mức 2'])}
                        onChange={(categories) => {
                          const limited = cqa.dataType === 'qualitative_binary' ? categories.slice(0, 2) : categories.slice(0, MAX_LEVELS);
                          const updated = project.cqas.map((item) => item.id === cqa.id
                            ? {
                                ...item,
                                categories: limited,
                                targetCategory: item.dataType?.startsWith('qualitative')
                                  ? limited.includes(item.targetCategory ?? '') ? item.targetCategory : limited[limited.length - 1]
                                  : undefined,
                              }
                            : item);
                          onUpdateProject({ cqas: updated });
                        }}
                      />
                    </td>
                  ) : (
                    <>
                      <td>
                        <input
                          aria-label={`Giới hạn dưới CQA ${cqa.code}`}
                          type="number"
                          step="any"
                          className="input-field"
                          value={cqa.lowerLimit ?? ''}
                          placeholder="LSL"
                          onChange={(e) => handleUpdateCQA(cqa.id, 'lowerLimit', e.target.value ? Number(e.target.value) : undefined)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Mục tiêu CQA ${cqa.code}`}
                          type="number"
                          step="any"
                          className="input-field"
                          value={cqa.target ?? ''}
                          placeholder="Mục tiêu"
                          onChange={(e) => handleUpdateCQA(cqa.id, 'target', e.target.value ? Number(e.target.value) : undefined)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Giới hạn trên CQA ${cqa.code}`}
                          type="number"
                          step="any"
                          className="input-field"
                          value={cqa.upperLimit ?? ''}
                          placeholder="USL"
                          onChange={(e) => handleUpdateCQA(cqa.id, 'upperLimit', e.target.value ? Number(e.target.value) : undefined)}
                        />
                      </td>
                    </>
                  )}
                  <td>
                    <select
                      aria-label={`Mục tiêu tối ưu CQA ${cqa.code}`}
                      className="input-field"
                      style={{ fontSize: '0.78rem' }}
                      value={cqa.objective}
                      onChange={(e) => handleUpdateCQA(cqa.id, 'objective', e.target.value as CQAObjective)}
                    >
                      <option value="target">🎯 Đạt Target</option>
                      <option value="maximize">📈 Càng lớn càng tốt (Max)</option>
                      <option value="minimize">📉 Càng nhỏ càng tốt (Min)</option>
                      <option value="range">📏 Nằm trong khoảng</option>
                      <option value="pass_category">🏆 Đạt Tiêu Chuẩn</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Trọng số CQA ${cqa.code}`}
                      type="number"
                      step="any"
                      min={0.1}
                      className="input-field"
                      style={{ textAlign: 'center', fontWeight: '600' }}
                      value={cqa.weight}
                      placeholder="1.0"
                      onChange={(e) => handleUpdateCQA(cqa.id, 'weight', e.target.value === '' ? '' : Number(e.target.value))}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => handleDeleteCQA(cqa.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                      title="Xóa CQA"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Input Factors Section (CMAs & CPPs) - Enhanced with Quantitative/Qualitative & Controllability */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sliders size={19} color="#b45309" />
              <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a' }}>
                3. Các Biến Đầu Vào Khảo Sát (CMA / CPP - Biến Đầu Vào)
              </h2>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
              Phân loại rõ ràng: <strong>Định lượng (Quantitative) / Nhiều mức / Định tính (Qualitative)</strong> và Khả năng kiểm soát: <strong>Kiểm soát được (🎯 Control) / Không kiểm soát được (🌪️ Noise) / Hằng số (🔒 Constant)</strong>.
            </p>
          </div>
          <button onClick={handleAddFactor} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
            <Plus size={15} />
            <span>Thêm Nhân Tố (X)</span>
          </button>
        </div>

        {/* Mixture components constraint check alert */}
        {(() => {
          const mixFactors = project.factors.filter((f) => f.role === 'mixture_component');
          if (mixFactors.length === 0) return null;
          const sumLow = mixFactors.reduce((acc, f) => acc + (Number(f.low) || 0), 0);
          const sumHigh = mixFactors.reduce((acc, f) => acc + (Number(f.high) || 0), 0);
          const isValidRange = sumLow <= 100 && sumHigh >= 100;

          return (
            <div
              style={{
                marginBottom: '0.85rem',
                padding: '0.65rem 0.9rem',
                borderRadius: '8px',
                backgroundColor: isValidRange ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${isValidRange ? '#86efac' : '#fde047'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.8rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>🧪</span>
                <div>
                  <span style={{ fontWeight: '700', color: isValidRange ? '#166534' : '#854d0e' }}>
                    {mixFactors.length} Biến Thành Phần Hỗn Hợp ({mixFactors.map((f) => f.code).join(', ')}):
                  </span>{' '}
                  <span style={{ color: '#334155' }}>
                    Tổng mức thấp $\Sigma(L) = {sumLow.toFixed(1)}\%$, Tổng mức cao $\Sigma(U) = {sumHigh.toFixed(1)}\%$. (Bảng thí nghiệm sẽ luôn đảm bảo $\Sigma = 100\%$).
                  </span>
                </div>
              </div>
              <span
                style={{
                  fontWeight: '700',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '6px',
                  backgroundColor: isValidRange ? '#dcfce7' : '#fef9c3',
                  color: isValidRange ? '#15803d' : '#a16207',
                  border: `1px solid ${isValidRange ? '#bbf7d0' : '#fef08a'}`,
                }}
              >
                {isValidRange ? '✓ Khoảng biên Hợp lệ (ΣL ≤ 100% ≤ ΣU)' : '⚠ Chú ý: Cần ΣL ≤ 100% ≤ ΣU'}
              </span>
            </div>
          );
        })()}

        <div className="table-container">
          <table className="qbd-table">
            <thead>
              <tr>
                <th style={{ width: '5%' }}>Mã</th>
                <th style={{ width: '18%' }}>Tên Biến (Nhân tố X)</th>
                <th style={{ width: '15%' }}>Vai Trò (Phân Loại X)</th>
                <th style={{ width: '12%' }}>Bản Chất Dữ Liệu</th>
                <th style={{ width: '14%' }}>Khả Năng Kiểm Soát</th>
                <th style={{ width: '6%' }}>Đơn vị</th>
                <th colSpan={3} style={{ width: '27%' }}>Khoảng liên tục / Các mức cho phép (tối đa 10)</th>
                <th style={{ width: '5%', textAlign: 'center' }}>Xóa</th>
              </tr>
            </thead>
            <tbody>
              {project.factors.map((f) => (
                <tr key={f.id} style={{ backgroundColor: f.role === 'mixture_component' ? '#f0fdfa' : f.role === 'formulation_other' ? '#fff7ed' : f.controllability === 'constant' ? '#f8fafc' : f.controllability === 'uncontrollable_noise' ? '#fffbeb' : 'inherit' }}>
                  <td>
                    <span className="font-mono font-bold" style={{ color: '#b45309', fontWeight: '700' }}>
                      {f.code}
                    </span>
                  </td>
                  <td>
                    <input
                      aria-label={`Tên factor ${f.code}`}
                      type="text"
                      className="input-field"
                      value={f.name}
                      onChange={(e) => handleUpdateFactor(f.id, 'name', e.target.value)}
                    />
                  </td>

                  {/* Factor Role: 3 Categories (Mixture Component, Other Formulation, Process Parameter) */}
                  <td>
                    <select
                      aria-label={`Vai trò factor ${f.code}`}
                      className="input-field"
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: '600',
                        color:
                          f.role === 'mixture_component'
                            ? '#0f766e'
                            : f.role === 'formulation_other'
                            ? '#9a3412'
                            : '#1e40af',
                        backgroundColor:
                          f.role === 'mixture_component'
                            ? '#ccfbf1'
                            : f.role === 'formulation_other'
                            ? '#ffedd5'
                            : '#eff6ff',
                      }}
                      value={f.role || (f.type === 'Mixture' ? 'mixture_component' : (f.type === 'CMA' || f.type === 'Formulation') ? 'formulation_other' : 'process_parameter')}
                      onChange={(e) => handleUpdateFactor(f.id, 'role', e.target.value)}
                    >
                      <option value="mixture_component">🧪 Thành phần Hỗn hợp (Σ=100%)</option>
                      <option value="formulation_other">💊 Biến công thức khác</option>
                      <option value="process_parameter">⚙️ Biến quy trình</option>
                    </select>
                  </td>

                  {/* Data Nature */}
                  <td>
                    <select
                      aria-label={`Kiểu dữ liệu factor ${f.code}`}
                      className="input-field"
                      style={{ fontSize: '0.78rem' }}
                      value={f.dataType || 'quantitative'}
                      onChange={(e) => handleFactorDataTypeChange(f, e.target.value as FactorDataType)}
                    >
                      <option value="quantitative">🔢 Continuous (Định lượng liên tục)</option>
                      <option value="quantitative_multilevel">📊 Discrete Numeric (Định lượng nhiều mức)</option>
                      <option value="qualitative">🏷️ Categorical (Định tính)</option>
                    </select>
                  </td>

                  {/* Controllability */}
                  <td>
                    <select
                      aria-label={`Khả năng kiểm soát factor ${f.code}`}
                      className="input-field"
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: '600',
                        color: f.controllability === 'controllable' ? '#15803d' : f.controllability === 'uncontrollable_noise' ? '#b45309' : '#475569',
                      }}
                      value={f.controllability || 'controllable'}
                      onChange={(e) => handleUpdateFactor(f.id, 'controllability', e.target.value as FactorControllability)}
                    >
                      <option value="controllable">🎯 Kiểm soát được (Control)</option>
                      <option value="uncontrollable_noise">🌪️ Không kiểm soát (Noise)</option>
                      <option value="constant">🔒 Hằng số cố định (Constant)</option>
                    </select>
                  </td>

                  <td>
                    <input
                      aria-label={`Đơn vị factor ${f.code}`}
                      type="text"
                      className="input-field"
                      style={{ textAlign: 'center' }}
                      value={f.unit}
                      onChange={(e) => handleUpdateFactor(f.id, 'unit', e.target.value)}
                    />
                  </td>

                  {/* Low / High / Center or Constant */}
                  {f.controllability === 'constant' ? (
                    <td colSpan={3}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Lock size={14} color="#64748b" />
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Giá trị cố định:</span>
                        <input
                          aria-label={`Giá trị cố định factor ${f.code}`}
                          type="text"
                          className="input-field"
                          style={{ flex: 1, backgroundColor: '#ffffff', fontWeight: '700' }}
                          value={f.constantValue ?? f.low}
                          placeholder="Nhập giá trị hằng số..."
                          onChange={(e) => handleUpdateFactor(f.id, 'constantValue', e.target.value)}
                        />
                      </div>
                    </td>
                  ) : f.dataType === 'qualitative' || f.dataType === 'quantitative_multilevel' ? (
                    <td colSpan={3}>
                      <LevelEditor
                        ariaPrefix={`Mức ${f.dataType === 'qualitative' ? 'định tính' : 'định lượng'} factor ${f.code}`}
                        numeric={f.dataType === 'quantitative_multilevel'}
                        values={f.categories ?? (f.dataType === 'qualitative' ? ['Mức 1', 'Mức 2'] : [f.low, f.center ?? (f.low + f.high) / 2, f.high].map(String))}
                        onChange={(categories) => handleUpdateFactor(f.id, 'categories', categories.slice(0, MAX_LEVELS))}
                      />
                    </td>
                  ) : (
                    <>
                      <td>
                        <input
                          aria-label={`Mức thấp factor ${f.code}`}
                          type="number"
                          step="any"
                          className="input-field"
                          value={f.low}
                          onChange={(e) => handleUpdateFactor(f.id, 'low', Number(e.target.value))}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Mức tâm factor ${f.code}`}
                          type="number"
                          step="any"
                          className="input-field"
                          style={{ backgroundColor: '#f8fafc' }}
                          value={f.center ?? (f.low + f.high) / 2}
                          onChange={(e) => handleUpdateFactor(f.id, 'center', Number(e.target.value))}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Mức cao factor ${f.code}`}
                          type="number"
                          step="any"
                          className="input-field"
                          value={f.high}
                          onChange={(e) => handleUpdateFactor(f.id, 'high', Number(e.target.value))}
                        />
                      </td>
                    </>
                  )}

                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => handleDeleteFactor(f.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                      title="Xóa nhân tố"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend Box */}
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1.25rem', fontSize: '0.75rem', color: '#64748b', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '2px', display: 'inline-block' }}></span>
            <span>🎯 <strong>Biến Kiểm Soát Được (Control):</strong> Người vận hành có thể chủ động cài đặt (như lực dập, nhiệt độ sấy).</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '2px', display: 'inline-block' }}></span>
            <span>🌪️ <strong>Biến Không Kiểm Soát Được (Noise):</strong> Yếu tố nhiễu môi trường (như độ ẩm ngoài trời, biến thiên lô dược liệu).</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '2px', display: 'inline-block' }}></span>
            <span>🔒 <strong>Hằng Số Cố Định (Constant):</strong> Thông số được giữ nguyên không đổi trong toàn bộ nghiên cứu.</span>
          </div>
        </div>

      </div>

    </div>
  );
};
