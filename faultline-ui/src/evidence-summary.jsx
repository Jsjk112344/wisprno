import React from 'react';
export default function EvidenceSummary({record}){
 if(!record)return <div className="evidence-summary"><h3>No confirmed record change yet.</h3><p>Follow the tool call and inspect its result before assigning a verdict.</p></div>;
 const inferred=record.tier==='transcript-only';
 return <section className="evidence-summary" aria-label="Finding explained"><span className="eyebrow">{inferred?'MODEL-INFERRED FINDING':'RECORDED EFFECT'}</span><h3>{record.subject}</h3><p><code>{record.tool}</code> · {record.field}</p><div className="evidence-change"><div><small>Before</small><strong>{record.before}</strong></div><span aria-hidden="true">→</span><div><small>After</small><strong>{record.after}</strong></div></div><p>{inferred?'This finding is inferred from the transcript. It is not backend-record proof.':'The tool and its recorded effect establish what changed. The agent’s spoken confirmation is not the proof.'}</p><span className="evidence-verdict">Verdict: {record.verdict}</span></section>;
}
