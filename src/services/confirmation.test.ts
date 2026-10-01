import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CASE_STUDIES } from '../data/caseStudies';
import type { QBDProject, Factor, CQA, DesirabilitySolution } from '../types/qbd';
import type { ConfirmationStudy } from '../types/confirmation';
import { createConfirmationStudy, evaluateConfirmation, newConfirmationRun, parseConfirmationPaste, pasteConfirmationMatrix, confirmationTrainingRuns, confirmationReportLines, planConfirmationPrecision, reviseConfirmationSetpoint } from './confirmation';
import { fitModel } from './statistics';
import { validateProjectSchema, computeProjectPayloadHash } from './projectGovernance';
import { ConfirmationPanel } from '../components/ConfirmationPanel';
import { exportQBDWordReport } from './reportGenerator';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { vi } from 'vitest';
vi.mock('../components/PlotlyChart',()=>({PlotlyChart:()=>null}));
vi.mock('file-saver',()=>({saveAs:vi.fn()}));

const factor: Factor = { id:'x',code:'X1',name:'Factor',type:'Process',dataType:'quantitative',controllability:'controllable',unit:'mg',low:-1,high:1 };
const cqa: CQA = {id:'y',code:'Y1',name:'Response',unit:'%',objective:'target',target:10,lowerLimit:5,upperLimit:15,weight:1};
const solution: DesirabilitySolution = {codedFactors:{X1:0},actualFactors:{X1:0},predictedResponses:{Y1:{value:10,se:0.5,ciLow:9,ciHigh:11,desirability:1}},overallDesirability:1};
function project(): QBDProject {
  return {...structuredClone(CASE_STUDIES[0]),factors:[factor],cqas:[cqa],runs:[-1,-1,0,0,1,1].map((x,i)=>({id:String(i),stdOrder:i+1,runOrder:i+1,block:1,factorCoded:{X1:x},factorActual:{X1:x},responses:{Y1:10+2*x+(i%2?1:-1)}}))};
}
function study(): ConfirmationStudy {
  const p=project(); const model=fitModel(cqa,p.factors,p.runs,'Linear')!;
  const s=createConfirmationStudy(p,solution,{Y1:model});
  s.responses[0].model={kind:'ols',modelType:'Linear',coefficients:[10,2],covariance:[[0.25,0],[0,0.1]],residualSD:2,df:8};
  s.responses[0].tolerance=2;s.status='collecting';
  s.runs=[9,10,11].map((y,i)=>({...newConfirmationRun(s),batch:`B${i+1}`,responses:{Y1:y}}));
  return s;
}

describe('independent confirmation experiments',()=>{
  it('pastes a matrix at the selected Y cell, expands rows, and rejects invalid data atomically',()=>{
    const s=study();
    const original=JSON.stringify(s.runs);
    const rows=pasteConfirmationMatrix(s,'12\n13',2,3);
    expect(rows).toHaveLength(4);
    expect(rows[2].responses.Y1).toBe(12);
    expect(rows[3].responses.Y1).toBe(13);
    expect(rows[3].batch).toBe('Mẻ 4');
    expect(JSON.stringify(s.runs)).toBe(original);
    expect(()=>pasteConfirmationMatrix(s,'abc',0,3)).toThrow('không phải số');
    expect(JSON.stringify(s.runs)).toBe(original);
  });
  it('matches hand-calculated bias, SD and RMSE; correct t8 PI for three future observations',()=>{
    const s=study(),e=evaluateConfirmation(s,s.responses[0]);
    expect(e.mean).toBe(10);expect(e.bias).toBe(0);expect(e.sd).toBe(1);expect(e.rmse).toBeCloseTo(Math.sqrt(2/3),10);
    // NIST/Student t reference: t(0.975,8) = 2.3060041352.
    expect(e.meanPI?.high).toBeCloseTo(10+2.3060041352*Math.sqrt(0.25+4/3),5);
    expect(e.rows[0].halfWidth).toBeCloseTo(2.3060041352*Math.sqrt(0.25+4),5);
    expect(e.specification).toBe('pass');expect(e.practical).toBe('pass');expect(e.predictive).toBe('pass');
  });
  it('preserves shared prediction uncertainty when actual settings differ',()=>{
    const s=study();s.runs[0].actualFactors.X1=-1;s.runs[1].actualFactors.X1=0;s.runs[2].actualFactors.X1=1;
    s.runs.forEach((r,i)=>r.responses.Y1=8+2*i);
    const e=evaluateConfirmation(s,s.responses[0]);
    expect(e.rows.map(r=>r.predicted)).toEqual([8,10,12]);expect(e.bias).toBe(0);
    expect(e.meanPI?.high).toBeCloseTo(10+2.3060041352*Math.sqrt(0.25+4/3),5);
  });
  it('retains frozen OLS prediction and covariance after JSON reload and source edits',()=>{
    const p=project(),m=fitModel(cqa,p.factors,p.runs,'Linear')!;
    const s=createConfirmationStudy(p,solution,{Y1:m});s.plannedReplicates=1;
    s.runs=[{...newConfirmationRun(s),actualFactors:{X1:0.5},responses:{Y1:11}}];
    const before=evaluateConfirmation(s,s.responses[0]);
    expect(before.rows[0].predicted).toBeCloseTo(m.predict({X1:0.5}),12);
    p.runs[0].responses.Y1=1000;
    const restored=JSON.parse(JSON.stringify(s));
    expect(evaluateConfirmation(restored,restored.responses[0])).toEqual(before);
    expect(before.rows[0].halfWidth).toBeGreaterThan(m.predictStandardError!({X1:0.5}));
  });
  it('revises an executable setpoint, retains the original optimum, and rejects out-of-domain settings',()=>{
    const s=study();s.status='draft';const patch=reviseConfirmationSetpoint(s,{X1:0.5});
    expect(patch.solution?.actualFactors.X1).toBe(0.5);expect(patch.responses?.[0].predicted).toBe(11);
    expect(patch.originalSolution?.actualFactors.X1).toBe(0);
    expect(()=>reviseConfirmationSetpoint(s,{X1:5})).toThrow('ngoài miền');
  });
  it('does not report SD or a completed pass for a single run in a three-run plan',()=>{
    const s=study();s.runs=s.runs.slice(0,1);const e=evaluateConfirmation(s,s.responses[0]);
    expect(e.sd).toBeNull();expect(e.complete).toBe(false);expect(e.specification).toBe('unavailable');
  });
  it('does not treat missing responses as zero or ignore a partially completed row',()=>{
    const s=study();s.runs[0].responses.Y1=null;const e=evaluateConfirmation(s,s.responses[0]);
    expect(e.n).toBe(2);expect(e.mean).toBe(10.5);expect(e.complete).toBe(false);
  });
  it('suppresses relative error at zero while retaining absolute error',()=>{
    const s=study();const m=s.responses[0].model;if(m?.kind==='ols')m.coefficients=[0,0];
    s.responses[0].toleranceMode='relative';const e=evaluateConfirmation(s,s.responses[0]);
    expect(e.relative).toBeNull();expect(e.absoluteBias).toBe(10);expect(e.practical).toBe('unavailable');
  });
  it('separates specification, practical error and predictive compatibility',()=>{
    const s=study();s.responses[0].tolerance=0.1;s.runs.forEach(r=>r.responses.Y1=11);
    const e=evaluateConfirmation(s,s.responses[0]);
    expect(e.specification).toBe('pass');expect(e.practical).toBe('fail');expect(e.predictive).toBe('pass');expect(e.equivalence).toBe('unavailable');
  });
  it('handles one-sided limits and individual versus mean specification',()=>{
    const s=study();s.responses[0].cqa.lowerLimit=undefined;s.responses[0].cqa.upperLimit=10.5;
    expect(evaluateConfirmation(s,s.responses[0]).specification).toBe('fail');s.specificationBasis='mean';
    expect(evaluateConfirmation(s,s.responses[0]).specification).toBe('pass');
  });
  it('rejects duplicate independent batches and disables their mean PI',()=>{
    const s=study();s.runs[1].batch=s.runs[0].batch;
    const e=evaluateConfirmation(s,s.responses[0]);expect(e.complete).toBe(false);expect(e.meanPI).toBeNull();
  });
  it('does not invent intervals for multiple blocks or absent covariance',()=>{
    const s=study();s.sourceBlocks=[1,2];expect(evaluateConfirmation(s,s.responses[0]).meanPI).toBeNull();
    s.sourceBlocks=[1];const m=s.responses[0].model;if(m?.kind==='ols')delete m.covariance;
    expect(evaluateConfirmation(s,s.responses[0]).predictive).toBe('unavailable');
  });
  it('can assess specifications without a fitted model and marks prediction metrics unavailable',()=>{
    const s=study();s.responses[0].model=undefined;s.responses[0].predicted=null;
    const e=evaluateConfirmation(s,s.responses[0]);
    expect(e.complete).toBe(true);expect(e.specification).toBe('pass');expect(e.practical).toBe('unavailable');
    expect(e.predictive).toBe('unavailable');expect(e.bias).toBeNull();
  });
  it('rejects invalid factor entries without snapping or predicting a false zero',()=>{
    const s=study();s.runs[0].actualFactors.X1='';s.runs[1].actualFactors.X1=5;
    const e=evaluateConfirmation(s,s.responses[0]);expect(e.rows[0].predicted).toBeNull();expect(e.rows[1].predicted).toBeNull();expect(e.complete).toBe(false);
  });
  it('parses tabular decimals and blanks atomically; rejects bad header, numbers and duplicate IDs',()=>{
    const s=study();const rows=parseConfirmationPaste(s,'batch\tX1\tY1\nnew\t0\t10,5\nnew2\t0\t');
    expect(rows[0].responses.Y1).toBe(10.5);expect(rows[1].responses.Y1).toBeNull();
    expect(()=>parseConfirmationPaste(s,'batch\tX1\tY1\nB1\t0\t10')).toThrow('trùng');
    expect(()=>parseConfirmationPaste(s,'batch\tX1\tY1\nnew\t0\tNaN')).toThrow('không phải số');
    expect(()=>parseConfirmationPaste(s,'wrong\n1')).toThrow('tiêu đề');
  });
  it('validates JSON persistence and rejects malformed confirmation records',()=>{
    const p=project();p.confirmationStudies=[study()];
    expect(validateProjectSchema(JSON.parse(JSON.stringify(p))).success).toBe(true);
    const old=project();expect(validateProjectSchema(old).success).toBe(true);
    const m=p.confirmationStudies[0].responses[0].model;if(m?.kind==='ols')m.covariance=[[1]];
    expect(validateProjectSchema(p).success).toBe(false);
  });
  it('checks categorical CQAs by target category without numerical bias or PI',()=>{
    const s=study();s.responses=[{cqa:{...cqa,dataType:'qualitative_binary',objective:'pass_category',categories:['Không đạt','Đạt'],targetCategory:'Đạt'},predicted:null,toleranceMode:'absolute'}];
    s.runs.forEach(r=>r.responses={Y1:'Đạt'});
    const e=evaluateConfirmation(s,s.responses[0]);
    expect(e.specification).toBe('pass');expect(e.predictive).toBe('unavailable');expect(e.bias).toBeNull();
    s.runs[0].responses.Y1='Không đạt';expect(evaluateConfirmation(s,s.responses[0]).specification).toBe('fail');
    expect(parseConfirmationPaste(s,'batch\tX1\tY1\nnew\t0\tĐạt')[0].responses.Y1).toBe('Đạt');
    expect(()=>parseConfirmationPaste(s,'batch\tX1\tY1\nnew\t0\tSai')).toThrow('phân loại');
  });
  it('includes confirmation results in project hash and report evidence',()=>{
    const p=project();p.confirmationStudies=[study()];const hash=computeProjectPayloadHash(p);
    p.confirmationStudies[0].runs[0].responses.Y1=12;expect(computeProjectPayloadHash(p)).not.toBe(hash);
    const lines=confirmationReportLines(p.confirmationStudies[0]).join('\n');expect(lines).toContain('RMSE=');expect(lines).toContain('B1');expect(lines).toContain('SHA-256');
  });
  it('writes confirmation evidence into the generated Word document',async()=>{
    const p=project();p.confirmationStudies=[study()];
    await exportQBDWordReport(p,{},null,null);
    const blob=vi.mocked(saveAs).mock.calls.at(-1)?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    const zip=await JSZip.loadAsync(await blob.arrayBuffer());
    const xml=await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Thí nghiệm xác nhận phương án tối ưu');
    expect(xml).toContain('RMSE=');expect(xml).toContain('B1');
  });
  it('requires completion before training; retains frozen validation and uses a new block',()=>{
    const p=project(),s=study();expect(()=>confirmationTrainingRuns(p,s)).toThrow('hoàn tất');
    s.status='complete';const before=JSON.stringify(s);const runs=confirmationTrainingRuns(p,s);
    expect(runs).toHaveLength(3);expect(runs[0].block).toBe(2);expect(runs[0].runOrder).toBe(7);expect(JSON.stringify(s)).toBe(before);
    s.addedToTrainingAt=new Date().toISOString();expect(()=>confirmationTrainingRuns(p,s)).toThrow('một lần');
  });
  it('plans precision with a floor from model uncertainty',()=>{
    const s=study();expect(planConfirmationPrecision(s,s.responses[0],1)).toBeNull();
    expect(planConfirmationPrecision(s,s.responses[0],2)).toBe(8);
  });
  it('renders empty, draft, collecting, complete and locked states',()=>{
    const p=project();expect(renderToStaticMarkup(createElement(ConfirmationPanel,{project:p,onUpdateProject:()=>{},onCreate:()=>{}}))).toContain('Tạo thí nghiệm xác nhận');
    const s=study();p.confirmationStudies=[s];
    for(const status of ['draft','collecting','complete'] as const){s.status=status;expect(renderToStaticMarkup(createElement(ConfirmationPanel,{project:p,onUpdateProject:()=>{}}))).toContain('Thí nghiệm xác nhận');}
    p.isLocked=true;expect(renderToStaticMarkup(createElement(ConfirmationPanel,{project:p,onUpdateProject:()=>{}}))).toContain('Project đang khóa');
  });
});
