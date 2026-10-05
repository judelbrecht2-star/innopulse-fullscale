"use client";
import {useState} from 'react';
import Link from 'next/link';
import {sb} from '../../lib/supabase';
import {REPORT_STATES,canApprove,canEdit} from '../lib/completion';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
export default function ReportDecisions({report,role,onSaved}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState(false),[note,setNote]=useState(''),[history,setHistory]=useState(null);
 const state=report.approval_state || 'legacy';
 async function decide(next){setBusy(true);setError('');try{const r=await sb().from('fs_reports').update({approval_state:next,decision_note:note.trim() || null}).eq('id',report.id).eq('approval_state',state).select('id').single();if(r.error || !r.data)throw r.error || new Error('This version changed. Refresh before making a decision.');await onSaved();}catch(ex){setError(ex.message || 'Could not save your decision.');}finally{setBusy(false);}}
 async function events(){setError('');const r=await sb().from('fs_report_events').select('from_state,to_state,note,created_at').eq('report_id',report.id).order('created_at');if(r.error)setError(r.error.message);else setHistory(r.data || []);}
 return <div className="report-decisions"><span className={`action-badge ${state==='approved'||state==='issued'?'done':'upcoming'}`}>{REPORT_STATES[state]}</span>{report.decision_note&&<p className="small">{report.decision_note}</p>}<div className="guide-controls">
 {canEdit(role)&&['draft','changes_requested'].includes(state)&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>decide('pending')}>Submit for approval</Button>}
 {canApprove(role)&&state==='pending'&&<Button size="sm" variant="outline" onClick={()=>setReview(!review)}>Review decision</Button>}
 {canApprove(role)&&state==='approved'&&<Button size="sm" disabled={busy} onClick={()=>decide('issued')}>Issue to client view</Button>}
 {report.rtype==='executive'&&['approved','issued'].includes(state)&&<Link className="btn btn-ghost btn-sm" href={`/client/reports/${report.id}`}>Client view</Link>}
 {canEdit(role)&&<Button size="sm" variant="ghost" onClick={events}>Decision history</Button>}</div>
 {review&&<div className="decision-form"><label>Decision note<Textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Explain changes or record your approval."/></label><div className="guide-controls"><Button size="sm" disabled={busy} onClick={()=>decide('approved')}>Approve this version</Button><Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={()=>decide('changes_requested')}>Request changes</Button></div><p className="small muted">Approval freezes this version. Content changes require a new version.</p></div>}
 {history&&<div className="decision-history">{history.length?history.map((h,i)=><p className="small" key={i}>{new Date(h.created_at).toLocaleString()} · {REPORT_STATES[h.to_state]}{h.note?` · ${h.note}`:''}</p>):<p className="small muted">No decisions recorded for this legacy version.</p>}<Button size="sm" variant="ghost" onClick={()=>setHistory(null)}>Hide history</Button></div>}{error&&<p className="err small" role="alert">{error}</p>}</div>;
}
