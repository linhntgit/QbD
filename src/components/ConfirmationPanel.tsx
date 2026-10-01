import { useEffect, useMemo, useState } from 'react';
import type { QBDProject } from '../types/qbd';
import type { ConfirmationStudy } from '../types/confirmation';
import { confirmationSourceHash, confirmationTrainingRuns, evaluateConfirmation, formatConfirmationNumber as fmt, parseConfirmationPaste, planConfirmationPrecision, reviseConfirmationSetpoint, validateConfirmationFactors, verdictLabel } from '../services/confirmation';
import { PlotlyChart } from './PlotlyChart';
import { ConfirmationMatrix } from './ConfirmationMatrix';

interface Props { project: QBDProject; onUpdateProject: (patch: Partial<QBDProject>) => void; onCreate?: () => void }

export function ConfirmationPanel({ project, onUpdateProject, onCreate }: Props) {
  const studies = project.confirmationStudies ?? [];
  const [selected, setSelected] = useState('');
  const latestId = studies[studies.length-1]?.id ?? '';
  useEffect(() => { setSelected(latestId); }, [latestId]);
  const study = studies.find(s => s.id === selected) ?? studies[studies.length-1];
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const [precision, setPrecision] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [setpoint, setSetpoint] = useState<Record<string, number | string>>({});
  const sourceHash = useMemo(()=>confirmationSourceHash(project),[project]);
  const evaluations = useMemo(()=>study?.responses.map(r=>evaluateConfirmation(study,r)) ?? [],[study]);
  const createButton = onCreate && <button className="btn btn-secondary" disabled={Boolean(project.isLocked)} onClick={onCreate}>Tạo thí nghiệm xác nhận</button>;
  if (!study) return <section className="qbd-card" id="confirmation" style={{borderTop:'4px solid #0d9488'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'0.75rem',flexWrap:'wrap'}}><h3>Thí nghiệm xác nhận phương án tối ưu</h3>{createButton}</div>
    <p>{onCreate ? 'Tạo hồ sơ từ điều kiện đang chọn trong Profiler để chốt tiêu chí và nhập kết quả thực nghiệm.' : 'Cần có phương án tối ưu và mô hình khả định để tạo hồ sơ xác nhận.'}</p>
  </section>;
  const locked = Boolean(project.isLocked);
  const editable = !locked && study.status !== 'complete';
  const save = (patch: Partial<ConfirmationStudy>, action: string) => {
    if (locked) return;
    const changedRuns = patch.runs ? study.runs.filter(previous => {
      const next = patch.runs?.find(r=>r.id===previous.id);
      return !next || JSON.stringify(previous)!==JSON.stringify(next);
    }) : [];
    const next = { ...study, ...patch, history: [...study.history, { at: new Date().toISOString(), action,
      before: JSON.stringify(patch.runs ? { changedRuns, previousCount: study.runs.length } : {
        status: study.status, name: study.name, plannedReplicates: study.plannedReplicates, confidence: study.confidence,
        specificationBasis: study.specificationBasis, actualFactors: study.solution.actualFactors,
        responses: study.responses.map(r=>({code:r.cqa.code,predicted:r.predicted,tolerance:r.tolerance,toleranceMode:r.toleranceMode})) }) }] };
    onUpdateProject({ confirmationStudies: studies.map(s=>s.id===study.id ? next : s) });
    setError('');
  };
  const allComplete = evaluations.length>0 && evaluations.every(e=>e.complete);
  const overall = (field: 'specification'|'practical'|'predictive') => evaluations.some(e=>e[field]==='fail') ? 'Không đạt' : evaluations.every(e=>e[field]==='pass') ? 'Đạt' : 'Chưa đủ cơ sở';
  const header = ['batch',...study.factors.map(f=>f.code),...study.responses.map(r=>r.cqa.code)].join('\t');
  return <section className="qbd-card" id="confirmation" style={{borderTop:'4px solid #0d9488'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'0.75rem',flexWrap:'wrap'}}><h3>Thí nghiệm xác nhận phương án tối ưu</h3>{createButton}</div>
    <label>Hồ sơ xác nhận <select value={study.id} onChange={e=>{setSelected(e.target.value);setError('');setPaste('');setPrecision('');setSetpoint({});}}>{studies.map(s=><option key={s.id} value={s.id}>{s.name} — {s.status}</option>)}</select></label>
    <p>Dự đoán và mô hình được lưu tại {new Date(study.createdAt).toLocaleString('vi-VN')}. Mỗi dòng là một mẻ/thí nghiệm độc lập; các phép đo lặp trên cùng mẫu cần tổng hợp trước khi nhập.</p>
    {sourceHash!==study.sourceHash && <p role="status" style={{color:'#92400e'}}>Mô hình hoặc dữ liệu hiện tại đã thay đổi. Hồ sơ này tiếp tục dùng mô hình được lưu khi lập kế hoạch.</p>}
    {locked && <p role="status">Project đang khóa. Chỉ xem kết quả.</p>}
    {error && <p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    <details open={study.status==='draft'}>
    <summary><strong>1. Điều kiện và tiêu chí đã định trước</strong> — {study.plannedReplicates} thí nghiệm, PI {study.confidence*100}%</summary>
    <fieldset disabled={locked || study.status!=='draft'} style={{padding:16,border:'1px solid #cbd5e1',borderRadius:8}}>
      <legend>1. Lập tiêu chí trước khi nhập kết quả</legend>
      <label>Tên hồ sơ <input aria-label="Tên hồ sơ xác nhận" value={study.name} onChange={e=>save({name:e.target.value},'Đổi tên hồ sơ')}/></label>{' '}
      <label>Số thí nghiệm độc lập <input aria-label="Số thí nghiệm độc lập" type="number" min={1} max={500} value={study.plannedReplicates} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=500)save({plannedReplicates:n},'Đổi số thí nghiệm dự kiến');}}/></label>{' '}
      <label>Mức PI <select value={study.confidence} onChange={e=>save({confidence:Number(e.target.value) as ConfirmationStudy['confidence']},'Đổi mức PI')}><option value={0.9}>90%</option><option value={0.95}>95%</option><option value={0.99}>99%</option></select></label>{' '}
      <label>Đánh giá specification theo <select value={study.specificationBasis} onChange={e=>save({specificationBasis:e.target.value as ConfirmationStudy['specificationBasis']},'Đổi cấp đánh giá specification')}><option value="individual">Từng mẻ</option><option value="mean">Trung bình các mẻ</option></select></label>
      <p>Điều kiện kế hoạch: {study.factors.map(f=>`${f.code}=${study.solution.actualFactors[f.code]} ${f.unit}`).join(' · ')}</p>
      <details><summary>Điều chỉnh điều kiện thực hiện sau làm tròn</summary><p>Nhập đầy đủ các thay đổi rồi áp dụng; app kiểm tra miền và tổng hỗn hợp trước khi tính lại dự đoán bằng mô hình đã lưu.</p>{study.factors.map(f=><label key={f.code}>{f.code} ({f.unit}) <input aria-label={`Điều kiện kế hoạch ${f.code}`} value={setpoint[f.code]??study.solution.actualFactors[f.code]??''} onChange={e=>setSetpoint({...setpoint,[f.code]:e.target.value})}/>{' '}</label>)}<button className="btn btn-secondary" onClick={()=>{try{save(reviseConfirmationSetpoint(study,{...study.solution.actualFactors,...setpoint}),'Điều chỉnh thông số sau làm tròn và tính lại dự đoán');setSetpoint({});}catch(e){setError((e as Error).message);}}}>Áp dụng điều kiện và tính lại dự đoán</button></details>
      <div className="table-container"><table className="qbd-table"><thead><tr><th>Đáp ứng</th><th>Dự đoán kế hoạch</th><th>Specification</th><th>Ngưỡng |sai lệch TB|</th><th>Đơn vị ngưỡng</th></tr></thead><tbody>{study.responses.map((r,i)=><tr key={r.cqa.code}><td>{r.cqa.name} ({r.cqa.code})</td><td>{fmt(r.predicted)} {r.cqa.unit}</td><td>{r.cqa.lowerLimit??'−∞'} → {r.cqa.upperLimit??'+∞'}</td><td><input type="number" min={0} step="any" aria-label={`Ngưỡng lệch ${r.cqa.code}`} value={r.tolerance??''} placeholder="Chưa đặt" onChange={e=>{const v=e.target.value===''?undefined:Number(e.target.value);if(v===undefined||Number.isFinite(v)&&v>=0)save({responses:study.responses.map((a,j)=>j===i?{...a,tolerance:v}:a)},`Đặt ngưỡng ${r.cqa.code}`);}}/></td><td><select aria-label={`Loại ngưỡng ${r.cqa.code}`} value={r.toleranceMode} onChange={e=>save({responses:study.responses.map((a,j)=>j===i?{...a,toleranceMode:e.target.value as 'absolute'|'relative'}:a)},`Đổi loại ngưỡng ${r.cqa.code}`)}><option value="absolute">{r.cqa.unit || 'Đơn vị gốc'} (tuyệt đối)</option><option value="relative">% tương đối</option></select></td></tr>)}</tbody></table></div>
      <p>Không đặt ngưỡng đồng nghĩa chưa kết luận được mức sai lệch chấp nhận. Với đáp ứng %, sai lệch theo đơn vị gốc là điểm phần trăm.</p>
      <details><summary>Ước lượng số lần lặp theo độ chính xác (OLS)</summary><label>Nửa độ rộng PI trung bình mong muốn, theo đơn vị từng đáp ứng <input type="number" min={0} step="any" value={precision} onChange={e=>setPrecision(e.target.value)}/></label>{study.responses.map(r=><p key={r.cqa.code}>{r.cqa.code}: {planConfirmationPrecision(study,r,Number(precision)) ?? 'Không tính được / thấp hơn giới hạn bất định mô hình'} thí nghiệm.</p>)}<p>Chỉ là lập kế hoạch độ chính xác với phương sai mô hình cố định, không phải tính power hay bảo đảm rằng ba lần lặp là đủ.</p></details>
      <button className="btn btn-primary" onClick={()=>{const errors=validateConfirmationFactors(study,study.solution.actualFactors);if(Object.keys(setpoint).length){setError('Hãy áp dụng các điều chỉnh điều kiện trước khi chốt.');return;}if(errors.length){setError(errors.join('; '));return;}save({status:'collecting'},'Chốt tiêu chí trước khi thu thập kết quả');}}>Chốt kế hoạch và nhập kết quả</button>
    </fieldset>
    </details>
    {study.status!=='draft' && <>
      <h4>2. Nhập kết quả thực nghiệm</h4>
      <fieldset disabled={!editable} style={{border:0,padding:0}}>
        <ConfirmationMatrix study={study} disabled={!editable} onSave={(runs,action)=>save({runs},action)} onError={setError}/>
        <details><summary>Dán bảng từ Excel</summary><p>Cột theo đúng thứ tự bên dưới; dùng tab giữa các cột. Dòng đầu phải có tiêu đề. Các dòng được thêm vào, không ghi đè.</p><pre style={{whiteSpace:'pre-wrap'}}>{header}</pre><textarea aria-label="Dữ liệu xác nhận từ Excel" rows={5} value={paste} onChange={e=>setPaste(e.target.value)} style={{width:'100%'}}/><button className="btn btn-secondary" onClick={()=>{try{const rows=parseConfirmationPaste(study,paste);if(study.runs.length+rows.length>500)throw new Error('Tối đa 500 mẻ mỗi hồ sơ.');save({runs:[...study.runs,...rows]},`Nhập ${rows.length} mẻ từ bảng`);setPaste('');}catch(e){setError((e as Error).message);}}}>Kiểm tra và thêm dữ liệu</button></details>
      </fieldset>
      <h4>3. Đánh giá tại điều kiện thực tế</h4>
      <p><strong>Chất lượng: {overall('specification')} · Ngưỡng lệch: {overall('practical')} · Phù hợp PI trung bình: {overall('predictive')}</strong></p>
      <p>PI áp dụng riêng cho từng đáp ứng. Nằm trong PI không chứng minh tương đương; xác nhận một điểm không xác nhận toàn bộ Design Space/PAR.</p>
      <div className="table-container"><table className="qbd-table"><thead><tr>{['Đáp ứng','n','Dự đoán TB thực tế','Thực nghiệm TB ± SD','Sai lệch TB / |lệch|','Lệch tương đối %','RMSE','PI của TB','Chất lượng','Ngưỡng lệch','Phù hợp PI'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{study.responses.map((r,i)=>{const e=evaluations[i];return <tr key={r.cqa.code}><td>{r.cqa.code} ({r.cqa.unit})</td><td>{e.n}/{study.plannedReplicates}</td><td>{fmt(e.predictedMean)}</td><td>{r.cqa.dataType?.startsWith('qualitative')?`Phân loại: ${r.cqa.targetCategory??'chưa có mức đích'}`:`${fmt(e.mean)} ± ${fmt(e.sd)}`}</td><td>{fmt(e.bias)} / {fmt(e.absoluteBias)}</td><td>{fmt(e.relative)}</td><td>{fmt(e.rmse)}</td><td>{e.meanPI?`${fmt(e.meanPI.low)} → ${fmt(e.meanPI.high)}`:'Chưa có PI'}</td><td>{verdictLabel(e.specification)}</td><td>{verdictLabel(e.practical)}</td><td>{verdictLabel(e.predictive)}</td></tr>;})}</tbody></table></div>
      {study.responses.map((r,i)=>{const e=evaluations[i];return <details key={r.cqa.code}><summary>{r.cqa.name}: chi tiết, biểu đồ và tương đương</summary>
        {e.warnings.map(w=><p key={w} role="status">{w}</p>)}
        <p>Sai lệch trung bình so với dự đoán kế hoạch: {fmt(e.plannedBias)} {r.cqa.unit}. Các chỉ số bias/RMSE và PI bên dưới so với dự đoán tại điều kiện thực tế của từng mẻ.</p>
        <p>CI 90% của bias (OLS): {e.bias!==null&&e.eqHalf!==null?`${fmt(e.bias-e.eqHalf)} → ${fmt(e.bias+e.eqHalf)}`:'chưa có'}. {e.equivalence==='pass'?'Đủ bằng chứng tương đương theo biên đã đặt và giả định OLS.':'Chưa chứng minh tương đương; không đồng nghĩa đã chứng minh khác biệt.'}</p>
        <div className="table-container"><table className="qbd-table"><thead><tr><th>Mẻ</th><th>Thực nghiệm</th><th>Dự đoán tại X thực tế</th><th>Sai lệch</th><th>PI cá thể</th><th>Đánh giá PI</th><th>Điều kiện</th></tr></thead><tbody>{e.rows.map(row=><tr key={row.run.id}><td>{row.run.batch}</td><td>{fmt(row.actual)}</td><td>{fmt(row.predicted)}</td><td>{fmt(row.error)}</td><td>{row.predicted!==null&&row.halfWidth!==null?`${fmt(row.predicted-row.halfWidth)} → ${fmt(row.predicted+row.halfWidth)}`:'Chưa có'}</td><td>{verdictLabel(row.pi)}</td><td>{row.errors.join('; ')||'Hợp lệ'}</td></tr>)}</tbody></table></div>
        {!r.cqa.dataType?.startsWith('qualitative') && <PlotlyChart data={[
          {x:e.rows.map(x=>x.run.batch),y:e.rows.map(x=>x.predicted),type:'scatter',mode:'markers',name:`Dự đoán ± PI ${study.confidence*100}%`,error_y:{type:'data',array:e.rows.map(x=>x.halfWidth??0),visible:e.rows.some(x=>x.halfWidth!==null)},marker:{color:'#2563eb',symbol:'diamond'}},
          {x:e.rows.map(x=>x.run.batch),y:e.rows.map(x=>x.actual),type:'scatter',mode:'markers',name:'Thực nghiệm',marker:{color:'#0d9488',size:10}},
        ]} layout={{height:320,title:{text:`${r.cqa.code} — ${r.cqa.unit}`},yaxis:{title:{text:r.cqa.unit}},shapes:[r.cqa.lowerLimit,r.cqa.upperLimit].filter((v):v is number=>v!==undefined).map(v=>({type:'line' as const,xref:'paper' as const,x0:0,x1:1,y0:v,y1:v,line:{color:'#dc2626',dash:'dash' as const}}))}}/>}
      </details>;})}
      {study.status==='collecting' && <button className="btn btn-primary" disabled={locked||!allComplete} onClick={()=>save({status:'complete'},'Hoàn tất đánh giá; giữ nguyên mô hình và kết quả xác nhận')}>Hoàn tất đánh giá và khóa kết quả</button>}
      {study.status==='complete' && <><p>Hồ sơ đã hoàn tất. Kết quả xác nhận giữ nguyên khi cập nhật mô hình.</p><label>Lý do sửa kết quả <input disabled={locked||Boolean(study.addedToTrainingAt)} value={changeReason} onChange={e=>setChangeReason(e.target.value)}/></label><button className="btn btn-secondary" disabled={locked||Boolean(study.addedToTrainingAt)||!changeReason.trim()} onClick={()=>{save({status:'collecting'},`Mở sửa kết quả: ${changeReason.trim()}`);setChangeReason('');}}>Mở sửa có lưu lịch sử</button>
        <details><summary>Bổ sung dữ liệu để xây dựng phiên bản mô hình mới</summary><p>Các mẻ được thêm vào DoE dưới một block mới; mô hình hiện tại sẽ tính lại. Hồ sơ xác nhận này vẫn dùng mô hình cũ. ANN cần huấn luyện lại. Đây không còn là tập xác nhận độc lập của mô hình mới.</p><button className="btn btn-secondary" disabled={locked||Boolean(study.addedToTrainingAt)} onClick={()=>{try{const runs=confirmationTrainingRuns(project,study);const at=new Date().toISOString();onUpdateProject({runs:[...project.runs,...runs],confirmationStudies:studies.map(s=>s.id===study.id?{...s,addedToTrainingAt:at,history:[...s.history,{at,action:'Bổ sung dữ liệu vào DoE dưới block mới sau khi hoàn tất xác nhận.'}]}:s)});setError('');}catch(e){setError((e as Error).message);}}}>{study.addedToTrainingAt?'Đã bổ sung vào DoE':'Bổ sung vào DoE và cập nhật mô hình'}</button></details>
      </>}
    </>}
    {studies.length>1 && <details><summary>So sánh các phương án đã xác nhận</summary><div className="table-container"><table className="qbd-table"><thead><tr><th>Phương án</th><th>Đáp ứng</th><th>n</th><th>Bias</th><th>RMSE</th><th>Chất lượng</th></tr></thead><tbody>{studies.flatMap(s=>s.responses.map(r=>{const e=evaluateConfirmation(s,r);return <tr key={`${s.id}-${r.cqa.code}`}><td>{s.name}</td><td>{r.cqa.code} ({r.cqa.unit})</td><td>{e.n}</td><td>{fmt(e.bias)}</td><td>{fmt(e.rmse)}</td><td>{verdictLabel(e.specification)}</td></tr>;}))}</tbody></table></div>
      {study.responses.filter(r=>!r.cqa.dataType?.startsWith('qualitative')).map(r=>{
        const pairs=studies.flatMap(s=>{const response=s.responses.find(x=>x.cqa.code===r.cqa.code);if(!response)return [];const e=evaluateConfirmation(s,response);return e.predictedMean!==null&&e.mean!==null?[{name:s.name,x:e.predictedMean,y:e.mean}]:[];});
        if(pairs.length<2)return null;
        const extent=[...pairs.flatMap(p=>[p.x,p.y])];const low=Math.min(...extent),high=Math.max(...extent);
        return <PlotlyChart key={r.cqa.code} data={[{x:pairs.map(p=>p.x),y:pairs.map(p=>p.y),text:pairs.map(p=>p.name),type:'scatter',mode:'markers+text',name:'Phương án',marker:{color:'#0d9488',size:11}},
          {x:[low,high],y:[low,high],type:'scatter',mode:'lines',name:'y = x',line:{color:'#64748b',dash:'dash'}}]}
          layout={{height:340,title:{text:`${r.cqa.code}: thực nghiệm so với dự đoán`},xaxis:{title:{text:`Dự đoán (${r.cqa.unit})`}},yaxis:{title:{text:`Thực nghiệm (${r.cqa.unit})`}}}}/>;
      })}
    </details>}
    <details><summary>Nguồn dữ liệu và lịch sử chỉnh sửa ({study.history.length})</summary><p style={{overflowWrap:'anywhere'}}>SHA-256 nguồn: {study.sourceHash}</p>{study.history.map((h,i)=><details key={i}><summary>{h.at} — {h.action}</summary>{h.before&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{h.before}</pre>}</details>)}</details>
  </section>;
}
