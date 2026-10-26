'use client'

import { useMemo, useRef, useState } from 'react'
import { analysisSchemaForResume, liveAnalysisSchema } from '@/lib/analysis'
import { AlertCircle, ArrowLeft, BriefcaseBusiness, Check, CheckCircle2, Clipboard, FileText, Lightbulb, Loader2, Pencil, Sparkles, WandSparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

type Status = 'Supported' | 'Partially supported' | 'Not documented'
type Requirement = { requirement: string; priority: 'Required' | 'Preferred' | 'Responsibility'; status: Status; evidence?: string | null; explanation: string }
type Suggestion = { title: string; reason: string; original: string; suggested: string }
type Analysis = { role: string; company?: string | null; assessment: string; requirements: Requirement[]; suggestions: Suggestion[]; questions: string[]; summary: string; mode: 'demo' | 'live' }

const MAX_LENGTH = 16000
const exampleResume = `Alex Morgan
Junior Production Engineer

Experience
Production Support Intern — Northstar Systems, 2023–2024
• Monitored production services and dashboards using Grafana and Splunk, escalating incidents and documenting resolutions.
• Investigated recurring incidents with SQL queries and partnered with senior engineers to identify root causes.
• Built a Python script to automate a repetitive log-cleanup task, reducing manual work for the team.

Projects
• Created a small alert-summary tool that grouped related events from exported logs and generated a daily report.

Skills
SQL · Python · Grafana · Splunk · Linux · Incident investigation`
const exampleJob = `Junior Production Engineer — CloudScale

We are looking for an early-career engineer to help keep reliable production systems running. You will monitor services, investigate incidents, and improve operational tooling alongside experienced engineers.

Requirements
• Experience with production monitoring and observability tools such as Grafana or Splunk.
• Strong troubleshooting skills and comfort investigating incidents with logs and SQL.
• Scripting ability in Python or a similar language.
• Familiarity with Linux, CI/CD pipelines, and Infrastructure as Code.
• Clear written communication and a collaborative approach.`

function demoAnalysis(resume: string, job: string, answers: string[] = []): Analysis {
  const isHebrew = /[\u0590-\u05ff]/.test(resume)
  return { mode: 'demo', role: /Junior Production Engineer/i.test(job) ? 'Junior Production Engineer' : 'Target role', company: /CloudScale/i.test(job) ? 'CloudScale' : undefined, assessment: isHebrew ? 'The documented experience is a strong foundation for this role, with clear evidence across monitoring, incident investigation, SQL, and scripting. CI/CD and Infrastructure as Code are not documented, so those areas should be clarified rather than assumed.' : 'Your experience maps well to the core operational work: monitoring, incident investigation, SQL, and scripting are clearly evidenced. CI/CD and Infrastructure as Code are not documented, so those areas should be clarified rather than assumed.', requirements: [
    { requirement: 'Production monitoring and observability', priority: 'Responsibility', status: 'Supported', evidence: 'Monitored production services and dashboards using Grafana and Splunk', explanation: 'Direct, relevant hands-on experience with the tools named in the role.' },
    { requirement: 'Incident investigation and troubleshooting', priority: 'Responsibility', status: 'Supported', evidence: 'Investigated recurring incidents with SQL queries', explanation: 'The resume shows investigation work and root-cause collaboration.' },
    { requirement: 'Python or scripting automation', priority: 'Required', status: 'Supported', evidence: 'Built a Python script to automate a repetitive log-cleanup task', explanation: 'A concrete automation project supports this requirement.' },
    { requirement: 'Linux, CI/CD, and Infrastructure as Code', priority: 'Required', status: 'Partially supported', evidence: 'Linux', explanation: 'Linux is listed, but the resume does not document CI/CD or Infrastructure as Code experience.' },
    { requirement: 'Written communication and collaboration', priority: 'Required', status: 'Partially supported', evidence: 'escalating incidents and documenting resolutions.', explanation: 'There is useful evidence, though the scope and ownership are not fully described.' },
  ], suggestions: [
    { title: 'Lead with observability', reason: 'This is one of the clearest matches to the role and makes the first experience bullet more searchable and specific.', original: 'Monitored production services and dashboards using Grafana and Splunk, escalating incidents and documenting resolutions.', suggested: 'Monitored production services with Grafana and Splunk, escalated incidents, and documented resolution steps for recurring operational issues.' },
    { title: 'Make the investigation method clearer', reason: 'The job emphasizes troubleshooting. Naming logs and SQL shows how you approached the work without inflating ownership.', original: 'Investigated recurring incidents with SQL queries and partnered with senior engineers to identify root causes.', suggested: 'Investigated recurring incidents using SQL queries, partnering with senior engineers to narrow down root causes.' },
    { title: 'Connect scripting to operations', reason: 'Framing the project around the operational problem makes the Python experience more relevant to production engineering.', original: 'Built a Python script to automate a repetitive log-cleanup task, reducing manual work for the team.', suggested: 'Built a Python automation script for repetitive log cleanup, reducing manual operational work for the team.' },
  ], questions: answers.length ? [] : ['Did you write the Python automation script yourself, and what did the log-cleanup task automate?', 'Did you use Linux directly when monitoring or investigating production incidents?'], summary: 'Early-career production engineer with hands-on experience monitoring services with Grafana and Splunk, investigating incidents with SQL, and building Python automation to reduce repetitive operational work.', }
}

function StatusBadge({ status }: { status: Status }) { return <Badge variant={status === 'Supported' ? 'default' : status === 'Partially supported' ? 'secondary' : 'outline'} className="gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"><span aria-hidden="true" className={`size-1.5 rounded-full ${status === 'Supported' ? 'bg-emerald-300' : status === 'Partially supported' ? 'bg-amber-500' : 'bg-muted-foreground'}`} />{status}</Badge> }

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) { const [copied, setCopied] = useState(false); return <Button variant="outline" size="sm" className="text-[#252525] hover:text-[#252525]" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400) }}><Check className={copied ? 'text-emerald-600' : 'hidden'} data-icon="inline-start" />{copied ? 'Copied' : label}</Button> }

export default function Page() {
  const [resume, setResume] = useState(''); const [job, setJob] = useState(''); const [answers, setAnswers] = useState<string[]>([]); const [analysis, setAnalysis] = useState<Analysis | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const canAnalyze = resume.trim().length > 0 && job.trim().length > 0 && resume.length <= MAX_LENGTH && job.length <= MAX_LENGTH
  const counts = useMemo(() => analysis ? analysis.requirements.reduce((a, r) => ({ ...a, [r.status]: a[r.status] + 1 }), { Supported: 0, 'Partially supported': 0, 'Not documented': 0 } as Record<Status, number>) : null, [analysis])
  const activeRequest = useRef<AbortController | null>(null)
  const runAnalysis = async (refineAnswers?: string[]) => {
    if (!canAnalyze) { setError('Add both your resume and the job description to continue.'); return }
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const timeout = setTimeout(() => controller.abort(), 75000)
    setLoading(true)
    setError('')
    setAnalysis(null)
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume, job, answers: refineAnswers ?? answers, questions: analysis?.questions ?? [] }),
        signal: controller.signal,
      })
      const data = await response.json().catch(() => null)
      if (activeRequest.current !== controller) return
      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'The analysis server could not complete the request. Please retry.'
        const reference = typeof data?.requestId === 'string' ? ' Reference: ' + data.requestId : ''
        setError(message + reference)
        return
      }
      const result = liveAnalysisSchema.safeParse(data)
      if (!result.success || !analysisSchemaForResume(resume).safeParse(result.data).success) {
        setError('The server returned an invalid analysis. Please retry; if this persists, check the server configuration.')
        return
      }
      setAnalysis(result.data)
      setAnswers(result.data.questions.map(() => ''))
    } catch {
      if (activeRequest.current !== controller) return
      setError(controller.signal.aborted
        ? 'Live analysis timed out. Your inputs are still here. Please retry.'
        : 'Could not reach the analysis server. Check your connection and retry. Your inputs are still here.')
    } finally {
      clearTimeout(timeout)
      if (activeRequest.current === controller) { activeRequest.current = null; setLoading(false) }
    }
  }
  const tryExample = () => {
    activeRequest.current?.abort()
    activeRequest.current = null
    setLoading(false)
    setResume(exampleResume); setJob(exampleJob); setAnalysis(demoAnalysis(exampleResume, exampleJob)); setError(''); setAnswers([])
  }
  const editInputs = () => setAnalysis(null)
  return <main className="min-h-screen bg-[#f5f5f3] text-[#252525]">
    <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-10">
      <header className="mb-14 flex items-center justify-between"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-[#4545a8] text-white shadow-sm"><Sparkles aria-hidden="true" className="size-4" /></div><div><div className="text-[17px] font-semibold tracking-tight">ResumeFit</div><div className="text-xs text-muted-foreground">Your experience. Better aligned.</div></div></div><Button variant="outline" size="sm" onClick={tryExample} className="bg-white"><WandSparkles data-icon="inline-start" />Try an example</Button></header>
      {!analysis && !loading ? <section><div className="mb-9 max-w-2xl"><p className="mb-3 text-sm font-medium text-[#5555a9]">Resume alignment workspace</p><h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Make your experience relevant.</h1><p className="mt-4 text-base leading-7 text-muted-foreground">Compare your resume with a job description and get grounded, actionable suggestions.</p></div><div className="grid gap-5 lg:grid-cols-2"><InputCard title="Your resume" icon={<FileText />} value={resume} onChange={setResume} placeholder="Paste your resume here…" id="resume" /><InputCard title="Job description" icon={<BriefcaseBusiness />} value={job} onChange={setJob} placeholder="Paste the job description here…" id="job" /></div><div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center"><Button size="lg" disabled={!canAnalyze} onClick={() => runAnalysis()} className="h-11 rounded-lg bg-[#4545a8] px-6 hover:bg-[#38388e]">Analyze fit <ArrowLeft className="rotate-180" data-icon="inline-end" /></Button><span className="text-xs text-muted-foreground">Suggestions stay grounded in the experience you provide.</span></div>{error && <Alert role="alert" variant="destructive" className="mt-5 max-w-xl"><AlertCircle data-icon="inline-start" /><AlertDescription>{error} <button onClick={() => runAnalysis()} className="ml-1 font-medium underline">Retry</button></AlertDescription></Alert>}</section> : loading ? <LoadingState /> : <Results analysis={analysis!} counts={counts!} resume={resume} job={job} answers={answers} setAnswers={setAnswers} onEdit={editInputs} onRefine={() => runAnalysis(answers)} />}
      <footer className="mt-16 border-t border-[#deded9] pt-5 text-xs text-muted-foreground">ResumeFit analyzes only the text you provide. It never invents qualifications or guarantees a hiring outcome.</footer>
    </div>
  </main>
}

function InputCard({ title, icon, value, onChange, placeholder, id }: { title: string; icon: React.ReactNode; value: string; onChange: (v: string) => void; placeholder: string; id: string }) { return <Card className="border-[#e2e2de] bg-white shadow-[0_12px_35px_rgba(40,40,30,0.04)]"><CardHeader className="flex flex-row items-center justify-between pb-3"><CardTitle className="flex items-center gap-2 text-sm font-semibold">{icon}<label htmlFor={id}>{title}</label></CardTitle><span className="text-xs tabular-nums text-muted-foreground">{value.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}</span></CardHeader><CardContent><Textarea id={id} dir="auto" value={value} maxLength={MAX_LENGTH} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="min-h-72 resize-y border-0 bg-[#fafaf9] p-4 text-sm leading-6 shadow-none focus-visible:ring-1 focus-visible:ring-[#7777c2]" aria-label={title} /></CardContent></Card> }

function LoadingState() { return <section><div className="mb-9"><Skeleton className="mb-3 h-4 w-40" /><Skeleton className="h-12 w-3/4" /><Skeleton className="mt-4 h-5 w-2/3" /></div><div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]"><Card><CardContent className="flex min-h-52 flex-col justify-center gap-4 p-6"><Loader2 className="size-5 animate-spin text-[#5555a9]" /><p className="text-sm text-muted-foreground">Comparing your experience with the role…</p><Skeleton className="h-2 w-full" /><Skeleton className="h-2 w-4/5" /></CardContent></Card><Card><CardContent className="flex flex-col gap-4 p-6"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></CardContent></Card></div></section> }

function Results({ analysis, counts, resume, job, answers, setAnswers, onEdit, onRefine }: { analysis: Analysis; counts: Record<Status, number>; resume: string; job: string; answers: string[]; setAnswers: (a: string[]) => void; onEdit: () => void; onRefine: () => void }) { return <section><div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-3 flex items-center gap-2 text-sm font-medium text-[#5555a9]"><CheckCircle2 className="size-4" />Analysis complete <Badge variant="outline" className="rounded-full text-[10px]">{analysis.mode === 'demo' ? 'Demo mode' : 'Live AI'}</Badge></p><h1 className="text-4xl font-semibold tracking-[-0.04em]">{analysis.role}</h1><p className="mt-2 text-muted-foreground">{analysis.company ? `${analysis.company} · ` : ''}A grounded view of your fit.</p></div><Button variant="outline" onClick={onEdit}><Pencil data-icon="inline-start" />Edit inputs</Button></div><div className="grid items-start gap-5 lg:grid-cols-[1fr_1.45fr]"><Card className="border-[#deded9] bg-white"><CardHeader><CardTitle className="text-base">At a glance</CardTitle><CardDescription className="leading-6">{analysis.assessment}</CardDescription></CardHeader><CardContent><div className="grid grid-cols-3 gap-2 border-t pt-5 text-center"><Metric value={counts.Supported} label="Supported" tone="good" /><Metric value={counts['Partially supported']} label="Partial" tone="warn" /><Metric value={counts['Not documented']} label="Not documented" tone="neutral" /></div></CardContent></Card><Card className="border-[#deded9] bg-white"><CardHeader><CardTitle className="text-base">Requirements &amp; responsibilities</CardTitle><CardDescription>Evidence is drawn from your resume, not assumptions.</CardDescription></CardHeader><CardContent className="flex flex-col gap-1">{analysis.requirements.map((r, i) => <div key={i} className="border-t py-4 first:border-t-0 first:pt-0"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium">{r.requirement}</p><p className="mt-1 text-[10px] font-medium text-muted-foreground">{r.priority === 'Required' ? 'Required qualification' : r.priority === 'Preferred' ? 'Preferred qualification' : 'Responsibility'}</p></div><StatusBadge status={r.status} /></div>{r.evidence && <p className="mt-2 text-xs italic text-muted-foreground">Resume excerpt: <q>{r.evidence}</q></p>}<p className="mt-1 text-xs leading-5 text-muted-foreground"><span className="font-medium">Paraphrase / interpretation: </span>{r.explanation}</p></div>)}</CardContent></Card></div><div className="mt-5 grid items-start gap-5 lg:grid-cols-[1.45fr_1fr]"><Card className="border-[#deded9] bg-white"><CardHeader><div className="flex items-center gap-2"><div className="flex size-8 items-center justify-center rounded-lg bg-[#ededff] text-[#5555a9]"><Lightbulb className="size-4" /></div><div><CardTitle className="text-base">Suggested improvements</CardTitle><CardDescription>Sharper wording, same experience.</CardDescription></div></div></CardHeader><CardContent className="flex flex-col gap-5">{analysis.suggestions.length === 0 && <p className="text-sm text-muted-foreground">No grounded wording changes to suggest.</p>}{analysis.suggestions.map((s, i) => <div key={i} className="rounded-xl border border-[#e7e7e2] bg-[#fbfbfa] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{s.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{s.reason}</p></div><CopyButton text={s.suggested} label="Copy suggestion" /></div><div className="mt-4 grid gap-3 md:grid-cols-2"><Quote label="Original" text={s.original} /><Quote label="Suggested" text={s.suggested} emphasized /></div></div>)}</CardContent></Card><div className="flex flex-col gap-5"><Card className="border-[#deded9] bg-white"><CardHeader><CardTitle className="text-base">Clarify your experience</CardTitle><CardDescription>Answers become evidence. Unanswered questions stay unconfirmed.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{analysis.questions.length ? analysis.questions.map((q, i) => <div key={q}><label htmlFor={`q-${i}`} className="text-xs font-medium leading-5">{q}</label><Textarea id={`q-${i}`} dir="auto" maxLength={2000} value={answers[i] || ''} onChange={e => { const next = [...answers]; next[i] = e.target.value; setAnswers(next) }} placeholder="Optional answer…" className="mt-2 min-h-20 bg-[#fafaf9] text-sm" /></div>) : <p className="text-sm text-muted-foreground">Thanks — your answers have been included as additional evidence.</p>}{analysis.questions.length > 0 && <Button onClick={onRefine} className="bg-[#4545a8] hover:bg-[#38388e]">Refine with my answers <Sparkles data-icon="inline-end" /></Button>}</CardContent></Card><Card className="border-[#deded9] bg-[#24243d] text-white"><CardHeader><CardTitle className="text-base text-white">Suggested professional summary</CardTitle><CardDescription className="text-white/65">Ready to paste. Based only on documented experience.</CardDescription></CardHeader><CardContent><p className="text-sm leading-6 text-white/90">{analysis.summary}</p><div className="mt-5"><CopyButton text={analysis.summary} label="Copy summary" /></div></CardContent></Card></div></div><p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Clipboard className="size-3.5" />Review every suggestion before adding it to your resume.</p></section> }
function Metric({ value, label, tone }: { value: number; label: string; tone: string }) { return <div><div className={`text-2xl font-semibold ${tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-muted-foreground'}`}>{value}</div><div className="mt-1 text-[11px] text-muted-foreground">{label}</div></div> }
function Quote({ label, text, emphasized }: { label: string; text: string; emphasized?: boolean }) { return <div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><div className={`rounded-lg border p-3 text-xs leading-5 ${emphasized ? 'border-[#cfcff4] bg-[#f1f1ff]' : 'border-[#e5e5e0] bg-white text-muted-foreground'}`}>{text}</div></div> }
