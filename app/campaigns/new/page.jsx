"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sb } from '../../../lib/supabase';
import { Shell } from '../../ui';
import { activeMembership } from '../../lib/org';
import SetupWizard from '../../components/setup-wizard';

export default function NewCampaign() {
  const router=useRouter();
  const [state,setState]=useState({loading:true,error:'',user:null,membership:null,versions:[],settings:{}});
  useEffect(()=>{let alive=true;(async()=>{try{
    const {data,error}=await sb().auth.getUser();if(error)throw error;if(!data.user){router.replace('/login');return;}
    const membership=await activeMembership(data.user.id);if(!membership)throw new Error('Ask your workspace owner to add your account.');
    const [v,s]=await Promise.all([sb().from('fs_questionnaire_versions').select('id,version').order('created_at',{ascending:false}),sb().from('fs_org_settings').select('default_campaign_duration_days,default_score_threshold,default_comment_threshold,default_questionnaire_version_id').eq('org_id',membership.org_id).maybeSingle()]);
    if(v.error || s.error)throw v.error || s.error;
    if(alive)setState({loading:false,error:'',user:data.user,membership,versions:v.data || [],settings:s.data || {}});
  }catch(ex){if(alive)setState(p=>({...p,loading:false,error:ex.message || 'Could not load setup.'}));}})();return()=>{alive=false;};},[router]);
  async function create(payload) {const {data,error}=await sb().rpc('fs_create_campaign_v3',payload);if(error || !data)throw new Error(error?.message || 'Could not create the assessment.');router.push(`/campaigns/${data}`);}
  return <Shell active="campaigns" user={state.user}><div className="crumbs"><Link href="/campaigns">Campaigns</Link> / New assessment</div><div className="pagehead"><div><p className="eyebrow">BUILD YOUR NEXT ASSESSMENT</p><h1>Start with a clear objective</h1><p className="lead">A considered setup makes every response more useful.</p></div></div>{state.loading?<p role="status">Loading setup…</p>:state.error?<div role="alert" className="err">{state.error}<p><button onClick={()=>window.location.reload()}>Try again</button></p></div>:!['owner','manager'].includes(state.membership.role)?<div className="card">An owner or assessment manager can create an assessment.</div>:<SetupWizard org={state.membership.fs_orgs} user={state.user} versions={state.versions} settings={state.settings} onCreate={create}/>}</Shell>;
}
