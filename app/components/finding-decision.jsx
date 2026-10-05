"use client";
import {useEffect,useState} from 'react';
import {sb} from '../../lib/supabase';
import {canEdit} from '../lib/completion';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
export default function FindingDecision({finding,review,campaign,user,role,onSaved}){
 const [decision,setDecision]=useState('accepted'),[title,setTitle]=useState(''),[text,setText]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setDecision(review?.decision || 'accepted');setTitle(review?.edited_title || finding.title);setText(review?.edited_text || finding.text);setReason(review?.decision_reason || '');setError('');},[finding.id,review]);
 async function save(e){e.preventDefault();setBusy(true);setError('');try{if(decision==='rejected'&&!reason.trim())throw new Error('Explain why this finding should be excluded.');if(decision==='edited'&&(!title.trim()||!text.trim()))throw new Error('Add an edited title and conclusion.');const r=await sb().from('fs_finding_reviews').upsert({campaign_id:campaign,rule_id:finding.id,decision,edited_title:decision==='edited'?title.trim():null,edited_text:decision==='edited'?text.trim():null,decision_reason:reason.trim()||null,reviewed_by:user.id,reviewed_at:new Date().toISOString()},{onConflict:'campaign_id,rule_id'}).select('*').single();if(r.error)throw r.error;onSaved(r.data);}catch(ex){setError(ex.message);}finally{setBusy(false);}}
 if(!canEdit(role))return <p className="small muted">Review decision: {review?.decision || 'Awaiting analyst review'}</p>;
 return <form className="finding-decision" onSubmit={save}><h3>Analyst decision</h3><p className="small muted">Accepted and edited findings enter new reports. Rejected findings retain their evidence here.</p><fieldset disabled={busy}><label>Decision<select value={decision} onChange={e=>setDecision(e.target.value)}><option value="accepted">Accept</option><option value="edited">Edit and accept</option><option value="rejected">Reject</option></select></label>{decision==='edited'&&<><label className="f">Report title<Input value={title} maxLength={300} onChange={e=>setTitle(e.target.value)}/></label><label className="f">Report conclusion<Textarea value={text} maxLength={4000} onChange={e=>setText(e.target.value)}/></label></>}<label className="f">Reason / context{decision==='rejected'?' (required)':''}<Textarea value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label><Button size="sm">{busy?'Saving…':'Save decision'}</Button>{review&&<span className="small muted"> · Saved: {review.decision}</span>}</fieldset>{error&&<p role="alert" className="err">{error}</p>}</form>;
}
