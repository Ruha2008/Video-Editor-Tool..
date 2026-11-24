import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Play, Pause, Plus, Trash2, Undo2, Redo2, ChevronLeft, ChevronRight, Scissors, Merge, Split, Film, FolderOpen, Download, Copy, Check, FlaskConical, BookOpen, Layers, ListVideo, Clock3, HardDrive, MonitorPlay, FileCode2, FolderTree, Terminal, AlertTriangle, CheckCircle2, XCircle, GripVertical, SkipBack, Loader2, Ban, Eraser, Keyboard } from 'lucide-react';
import { PYTHON_FILES, FOLDER_TREE } from './lib/pythonSource';
import { runTimelineTests, type TestResult } from './lib/timeline';

type View = 'home' | 'editor' | 'source' | 'tests' | 'docs';
interface Project { id: number; name: string; description: string; created_at: string; }
interface Media { id: number; name: string; filename: string; duration_sec: number; format: string; size_mb: number; resolution: string; color: string; is_sample: boolean; }
interface Clip { id: number; project_id: number; name: string; source: string; duration_sec: number; trim_start: number; trim_end: number; position: number; color: string; }
interface Job { id: number; project_id: number; name: string; format: string; resolution: string; status: string; progress: number; created_at: string; }
interface HistEntry { label: string; snapshot: Clip[]; }

const PALETTE = ['#6366f1', '#0ea5e9', '#f59e0b', '#ec4899', '#10b981', '#f97316', '#a78bfa', '#22d3ee'];
const eff = (c: Clip) => Math.max(0, Number(c.trim_end) - Number(c.trim_start));
const fmtT = (s: number) => { const m = Math.floor(s / 60), ss = Math.floor(s % 60), t = Math.floor((s % 1) * 10); return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${t}`; };
const clone = (x: Clip[]) => JSON.parse(JSON.stringify(x)) as Clip[];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function api(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data;
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [projects, setProjects] = useState<Project[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [newProject, setNewProject] = useState({ name: '', description: '' });
  const [custom, setCustom] = useState({ name: '', duration: '12', format: 'mp4' });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [undoStack, setUndoStack] = useState<HistEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistEntry[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportFmt, setExportFmt] = useState('mp4');
  const [exportRes, setExportRes] = useState('1080p');
  const [processing, setProcessing] = useState(false);
  const [srcIdx, setSrcIdx] = useState(2);
  const [copied, setCopied] = useState(false);
  const [tests, setTests] = useState<TestResult[] | null>(null);
  const clipsRef = useRef<Clip[]>([]);
  clipsRef.current = clips;

  const say = (type: 'ok' | 'err', text: string) => { setMsg({ type, text }); };
  const project = projects.find(p => p.id === projectId) || null;
  const sorted = useMemo(() => [...clips].sort((a, b) => a.position - b.position), [clips]);
  const total = useMemo(() => sorted.reduce((s, c) => s + eff(c), 0), [sorted]);
  const selected = sorted.find(c => c.id === selectedId) || null;
  const selectedIdx = selected ? sorted.findIndex(c => c.id === selected.id) : -1;

  const currentClip = useMemo(() => {
    let acc = 0;
    for (const c of sorted) { const d = eff(c); if (playhead < acc + d) return { clip: c, offset: playhead - acc }; acc += d; }
    return sorted.length ? { clip: sorted[sorted.length - 1], offset: eff(sorted[sorted.length - 1]) } : null;
  }, [sorted, playhead]);

  const loadClipsJobs = useCallback(async (pid: number) => {
    const [c, j] = await Promise.all([api(`/api/clips?project_id=${pid}`), api(`/api/jobs?project_id=${pid}`)]);
    setClips(c); setJobs(j); setUndoStack([]); setRedoStack([]); setPlayhead(0); setPlaying(false);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api('/api/projects'), api('/api/media')]);
      setProjects(p); setMedia(m);
      if (p.length) { const pid = projectId && p.some((x: Project) => x.id === projectId) ? projectId : p[0].id; setProjectId(pid); await loadClipsJobs(pid); }
    } catch (e) { say('err', String(e instanceof Error ? e.message : e)); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (selected) { setTrimStart(Number(selected.trim_start)); setTrimEnd(Number(selected.trim_end)); } }, [selectedId]); // eslint-disable-line
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setPlayhead(p => { const n = p + 0.1; if (n >= total) { setPlaying(false); return total; } return Math.round(n * 10) / 10; }), 100);
    return () => clearInterval(id);
  }, [playing, total]);

  // ---- history (two stacks) --------------------------------------------
  const record = (label: string) => { setUndoStack(s => [...s.slice(-99), { label, snapshot: clone(clipsRef.current) }]); setRedoStack([]); };

  const reconcile = async (target: Clip[]) => {
    const current = clipsRef.current;
    const targetIds = new Set(target.map(c => c.id));
    for (const c of current) if (!targetIds.has(c.id)) await api('/api/clips', 'DELETE', { id: c.id });
    const out: Clip[] = [];
    const sortedT = [...target].sort((a, b) => a.position - b.position);
    for (let i = 0; i < sortedT.length; i++) {
      const t = sortedT[i];
      if (current.some(c => c.id === t.id)) out.push(await api('/api/clips', 'PUT', { id: t.id, name: t.name, source: t.source, duration_sec: t.duration_sec, trim_start: t.trim_start, trim_end: t.trim_end, position: i, color: t.color }));
      else out.push(await api('/api/clips', 'POST', { project_id: projectId, name: t.name, source: t.source, duration_sec: t.duration_sec, trim_start: t.trim_start, trim_end: t.trim_end, position: i, color: t.color }));
    }
    setClips(out);
  };

  const doUndo = useCallback(async () => {
    if (!undoStack.length || busy) { say('err', 'Nothing to undo — the undo stack is empty.'); return; }
    setBusy(true);
    try { const entry = undoStack[undoStack.length - 1]; setUndoStack(s => s.slice(0, -1)); setRedoStack(s => [...s, { label: entry.label, snapshot: clone(clipsRef.current) }]); await reconcile(entry.snapshot); say('ok', `Undid: ${entry.label}`); }
    catch (e) { say('err', String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack, busy, projectId]);

  const doRedo = useCallback(async () => {
    if (!redoStack.length || busy) { say('err', 'Nothing to redo — the redo stack is empty.'); return; }
    setBusy(true);
    try { const entry = redoStack[redoStack.length - 1]; setRedoStack(s => s.slice(0, -1)); setUndoStack(s => [...s, { label: entry.label, snapshot: clone(clipsRef.current) }]); await reconcile(entry.snapshot); say('ok', `Redid: ${entry.label}`); }
    catch (e) { say('err', String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redoStack, busy, projectId]);

  // ---- timeline mutations ------------------------------------------------
  async function guard(label: string, fn: () => Promise<void>) {
    if (!projectId) { say('err', 'Create or open a project first.'); return; }
    record(label); setBusy(true);
    try { await fn(); say('ok', label + ' — timeline saved.'); }
    catch (e) { setUndoStack(s => s.slice(0, -1)); say('err', String(e instanceof Error ? e.message : e)); if (projectId) await loadClipsJobs(projectId).catch(() => {}); }
    finally { setBusy(false); }
  }

  const refetchClips = async () => { if (projectId) setClips(await api(`/api/clips?project_id=${projectId}`)); };

  const addFromMedia = (m: Media) => guard(`Add “${m.name}”`, async () => {
    const row = await api('/api/clips', 'POST', { project_id: projectId, name: m.name, source: m.filename, duration_sec: m.duration_sec, trim_start: 0, trim_end: m.duration_sec, position: sorted.length, color: m.color });
    setClips(s => [...s, row]); setSelectedId(row.id);
  });

  const addCustom = async () => {
    const name = custom.name.trim(); const dur = Number(custom.duration);
    if (!name) return say('err', 'Give the clip a name first (empty names are rejected — see Clip.__post_init__).');
    if (!dur || dur < 1 || dur > 600) return say('err', 'Duration must be between 1 and 600 seconds.');
    if (!projectId) return say('err', 'Open a project first.');
    try {
      setBusy(true);
      const m = await api('/api/media', 'POST', { name, duration_sec: dur, format: custom.format, color: PALETTE[media.length % PALETTE.length] });
      setMedia(s => [...s, m]); setCustom({ name: '', duration: '12', format: 'mp4' });
      record(`Add “${name}”`);
      const row = await api('/api/clips', 'POST', { project_id: projectId, name: m.name, source: m.filename, duration_sec: m.duration_sec, trim_start: 0, trim_end: m.duration_sec, position: sorted.length, color: m.color });
      setClips(s => [...s, row]); setSelectedId(row.id);
      say('ok', `Added “${name}” to the media library and the timeline. (Local Flask version: drop ${m.filename} into uploads/ for a real render.)`);
    } catch (e) { say('err', String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
  };

  const removeClip = (c: Clip) => guard(`Delete “${c.name}”`, async () => {
    await api('/api/clips', 'DELETE', { id: c.id });
    const rest = sorted.filter(x => x.id !== c.id);
    for (let i = 0; i < rest.length; i++) if (rest[i].position !== i) await api('/api/clips', 'PUT', { id: rest[i].id, position: i });
    setSelectedId(null); await refetchClips();
  });

  const reorderTo = (order: Clip[], label: string) => guard(label, async () => {
    for (let i = 0; i < order.length; i++) await api('/api/clips', 'PUT', { id: order[i].id, position: i });
    setClips(order.map((c, i) => ({ ...c, position: i })));
  });

  const moveSelected = (dir: -1 | 1) => {
    if (!selected) return say('err', 'Select a clip on the timeline first.');
    const to = selectedIdx + dir;
    if (to < 0 || to >= sorted.length) return say('err', `Cannot move ${dir < 0 ? 'left' : 'right'}: index ${to} is out of range (0..${sorted.length - 1}).`);
    const order = [...sorted]; const [c] = order.splice(selectedIdx, 1); order.splice(to, 0, c);
    reorderTo(order, `Move “${selected.name}” ${selectedIdx} → ${to}`);
  };

  const applyTrim = () => {
    if (!selected) return say('err', 'Select a clip to trim.');
    const dur = Number(selected.duration_sec);
    if (trimStart < 0 || trimEnd > dur || trimEnd - trimStart < 0.5) return say('err', `Invalid trim ${trimStart.toFixed(1)}s..${trimEnd.toFixed(1)}s for a ${dur}s clip. Need 0 ≤ start < end ≤ duration, at least 0.5s remaining.`);
    return guard(`Trim “${selected.name}”`, async () => {
      const row = await api('/api/clips', 'PUT', { id: selected.id, trim_start: trimStart, trim_end: trimEnd });
      setClips(s => s.map(c => c.id === row.id ? row : c));
    });
  };

  const joinSelected = () => {
    if (!selected) return say('err', 'Select a clip to join with the next one.');
    if (selectedIdx + 1 >= sorted.length) return say('err', 'Join needs a following clip — this is the last clip on the timeline.');
    const a = sorted[selectedIdx], b = sorted[selectedIdx + 1]; const dur = eff(a) + eff(b);
    return guard(`Join “${a.name}” + “${b.name}”`, async () => {
      await api('/api/clips', 'PUT', { id: a.id, name: `${a.name} + ${b.name}`, duration_sec: dur, trim_start: 0, trim_end: dur });
      await api('/api/clips', 'DELETE', { id: b.id });
      const rest = sorted.filter(x => x.id !== b.id);
      for (let i = 0; i < rest.length; i++) if (rest[i].position !== i) await api('/api/clips', 'PUT', { id: rest[i].id, position: i });
      await refetchClips();
    });
  };

  const splitSelected = () => {
    if (!selected) return say('err', 'Select a clip to split.');
    const d = eff(selected); if (d < 1) return say('err', 'Clip is too short to split (needs at least 1s).');
    const mid = Math.round((Number(selected.trim_start) + d / 2) * 10) / 10;
    return guard(`Split “${selected.name}”`, async () => {
      for (let i = sorted.length - 1; i > selectedIdx; i--) await api('/api/clips', 'PUT', { id: sorted[i].id, position: i + 1 });
      await api('/api/clips', 'PUT', { id: selected.id, trim_end: mid });
      await api('/api/clips', 'POST', { project_id: projectId, name: selected.name + ' (2)', source: selected.source, duration_sec: selected.duration_sec, trim_start: mid, trim_end: selected.trim_end, position: selectedIdx + 1, color: selected.color });
      await refetchClips();
    });
  };

  // ---- projects & jobs ---------------------------------------------------
  const createProject = async () => {
    if (!newProject.name.trim()) return say('err', 'Project name is required.');
    try { const p = await api('/api/projects', 'POST', newProject); setProjects(s => [p, ...s]); setNewProject({ name: '', description: '' }); setProjectId(p.id); await loadClipsJobs(p.id); say('ok', `Project “${p.name}” created — opening the editor.`); setView('editor'); }
    catch (e) { say('err', String(e instanceof Error ? e.message : e)); }
  };
  const deleteProject = async (p: Project) => {
    if (!confirm(`Delete project “${p.name}” and its timeline?`)) return;
    await api('/api/projects', 'DELETE', { id: p.id }); const rest = projects.filter(x => x.id !== p.id); setProjects(rest);
    if (projectId === p.id) { setProjectId(rest[0]?.id ?? null); if (rest[0]) await loadClipsJobs(rest[0].id); else { setClips([]); setJobs([]); } }
  };
  const openProject = async (pid: number) => { setProjectId(pid); await loadClipsJobs(pid); setView('editor'); };

  const enqueueJob = async () => {
    if (!projectId) return say('err', 'Open a project first.');
    if (!sorted.length) return say('err', 'Nothing to export: the timeline is empty. Add at least one clip.');
    try { const j = await api('/api/jobs', 'POST', { project_id: projectId, name: `${project?.name || 'export'}.${exportFmt}`, format: exportFmt, resolution: exportRes }); setJobs(s => [...s, j]); say('ok', `Enqueued “${j.name}” at the back of the FIFO render queue.`); }
    catch (e) { say('err', String(e instanceof Error ? e.message : e)); }
  };

  const processQueue = async (all: boolean) => {
    if (processing) return;
    let pending = jobs.filter(j => j.status === 'queued');
    if (!pending.length) return say('err', 'The render queue is empty — enqueue an export first.');
    if (!all) pending = pending.slice(0, 1);
    setProcessing(true);
    try {
      for (const job of pending) {
        setJobs(s => s.map(j => j.id === job.id ? { ...j, status: 'rendering', progress: 0 } : j));
        // encode_video() simulation: in the Flask app this is where ffmpeg runs via subprocess.
        for (let p = 10; p <= 100; p += 10) { await sleep(220); setJobs(s => s.map(j => j.id === job.id ? { ...j, progress: p } : j)); }
        const done = await api('/api/jobs', 'PUT', { id: job.id, status: 'done', progress: 100 });
        setJobs(s => s.map(j => j.id === job.id ? done : j));
      }
      say('ok', 'Render finished (simulated encode — swap encode_video() for the ffmpeg/subprocess version in editor/render_queue.py for real files).');
    } catch (e) { say('err', String(e instanceof Error ? e.message : e)); } finally { setProcessing(false); }
  };

  const cancelJob = async (j: Job) => { const row = await api('/api/jobs', 'PUT', { id: j.id, status: 'cancelled', progress: 0 }); setJobs(s => s.map(x => x.id === j.id ? row : x)); };
  const deleteJob = async (j: Job) => { await api('/api/jobs', 'DELETE', { id: j.id }); setJobs(s => s.filter(x => x.id !== j.id)); };
  const clearFinished = async () => { for (const j of jobs.filter(j => j.status === 'done' || j.status === 'cancelled')) await api('/api/jobs', 'DELETE', { id: j.id }); setJobs(s => s.filter(j => j.status === 'queued' || j.status === 'rendering')); };

  // keyboard shortcuts
  const stateRef = useRef({ view, selected, doUndo, doRedo }); stateRef.current = { view, selected, doUndo, doRedo };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = stateRef.current; if (st.view !== 'editor') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.doRedo() : st.doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); st.doRedo(); }
      else if (e.key === ' ' && sorted.length) { e.preventDefault(); setPlaying(p => !p); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [sorted.length]);

  const downloadText = (filename: string, text: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = filename; a.click(); URL.revokeObjectURL(a.href); };
  const srcFile = PYTHON_FILES[srcIdx];
  const estMB = Math.max(1, Math.round(total * (exportRes === '4K' ? 5.4 : exportRes === '1080p' ? 1.8 : 0.8)));

  const nav: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'Home', icon: <FolderOpen size={16} /> }, { id: 'editor', label: 'Editor', icon: <Clapperboard size={16} /> },
    { id: 'source', label: 'Python Source', icon: <FileCode2 size={16} /> }, { id: 'tests', label: 'Tests', icon: <FlaskConical size={16} /> }, { id: 'docs', label: 'Docs', icon: <BookOpen size={16} /> },
  ];

  if (loading) return <div className="min-h-screen bg-[#0b0d14] text-white flex items-center justify-center gap-3"><Loader2 className="animate-spin" /> Loading CutStudio…</div>;

  return (
    <div className="min-h-screen bg-[#0b0d14] text-zinc-100" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
      <header className="sticky top-0 z-40 bg-[#0b0d14]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <button onClick={() => setView('home')} className="flex items-center gap-2.5 mr-2">
            <span className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center"><Clapperboard size={19} /></span>
            <span className="text-left leading-tight"><span className="block font-black tracking-tight">CutStudio</span><span className="block text-[11px] text-zinc-400">Video Editor · Python + Flask, live in your browser</span></span>
          </button>
          <nav className="flex flex-wrap gap-1.5 ml-auto">
            {nav.map(n => <button key={n.id} onClick={() => setView(n.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold ${view === n.id ? 'bg-indigo-600 text-white' : 'bg-white/5 hover:bg-white/10 text-zinc-300'}`}>{n.icon}{n.label}</button>)}
          </nav>
        </div>
        {msg && <div className={`max-w-7xl mx-auto px-4 pb-3`}><div className={`flex gap-2 items-start text-sm rounded-xl px-4 py-2.5 ${msg.type === 'ok' ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30' : 'bg-red-500/15 text-red-200 border border-red-500/30'}`}>{msg.type === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}<span>{msg.text}</span><button className="ml-auto opacity-60" onClick={() => setMsg(null)}>✕</button></div></div>}
      </header>

      <main className="max-w-7xl mx-auto px-4 pb-16">
        {/* ================= HOME ================= */}
        {view === 'home' && <>
          <section className="grid lg:grid-cols-2 gap-8 items-center py-10">
            <div>
              <span className="text-indigo-300 bg-indigo-500/15 border border-indigo-500/30 text-xs font-bold px-3 py-1.5 rounded-full">SELF-CONTAINED · FLASK · NO HEAVY DEPENDENCIES</span>
              <h1 className="text-4xl md:text-5xl font-black tracking-tight mt-5 leading-[1.05]">A video editor you can<br /><span className="text-indigo-400">actually read.</span></h1>
              <p className="text-zinc-400 mt-4 text-lg leading-relaxed">A complete local video-editor tool built around three textbook data structures — an <b className="text-zinc-200">array-backed timeline</b>, <b className="text-zinc-200">two stacks</b> for undo/redo, and a <b className="text-zinc-200">FIFO queue</b> for renders. Try the live editor here, then download the full annotated Python + Flask source and run it yourself.</p>
              <div className="flex flex-wrap gap-3 mt-6">
                <button onClick={() => setView('editor')} className="bg-indigo-600 hover:bg-indigo-500 px-5 py-3 rounded-xl font-bold flex items-center gap-2"><MonitorPlay size={18} /> Open the editor</button>
                <button onClick={() => setView('source')} className="bg-white/10 hover:bg-white/15 px-5 py-3 rounded-xl font-bold flex items-center gap-2"><FileCode2 size={18} /> Get the Python source</button>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-8 text-center">
                {[['O(1)', 'index access\n(array)'], ['LIFO', 'undo / redo\n(2 stacks)'], ['FIFO', 'render jobs\n(deque queue)']].map(([a, b]) => <div key={a} className="bg-white/5 border border-white/10 rounded-2xl p-4"><div className="text-2xl font-black text-indigo-300">{a}</div><div className="text-xs text-zinc-400 whitespace-pre-line mt-1">{b}</div></div>)}
              </div>
            </div>
            <div className="relative">
              <img src="/images/hero-editor.jpg" alt="Video editing suite" className="rounded-3xl w-full h-[420px] object-cover border border-white/10" />
              <div className="absolute -bottom-5 left-5 right-5 bg-[#12151f] border border-white/10 rounded-2xl p-4 shadow-2xl">
                <div className="text-xs text-zinc-400 font-bold mb-2">LIVE SEQUENCE — {project?.name || 'No project yet'}</div>
                <div className="flex gap-1.5 h-11">{sorted.length ? sorted.map(c => <div key={c.id} title={c.name} className="rounded-lg flex items-end p-1.5 text-[10px] font-bold overflow-hidden" style={{ background: c.color, flex: Math.max(1, eff(c)) }}>{c.name}</div>) : <div className="text-zinc-500 text-sm">Empty timeline — open the editor and add clips.</div>}</div>
                <div className="text-xs text-zinc-400 mt-2">{sorted.length} clips · {total.toFixed(1)}s total</div>
              </div>
            </div>
          </section>

          <section className="mt-14">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><h2 className="text-2xl font-black">Your projects</h2><p className="text-zinc-400 text-sm mt-1">Persisted in the database. In the local Flask version these live in memory (see the trade-off note in app.py).</p></div>
              <div className="flex flex-wrap gap-2">
                <input value={newProject.name} onChange={e => setNewProject({ ...newProject, name: e.target.value })} placeholder="New project name *" className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm w-52" />
                <input value={newProject.description} onChange={e => setNewProject({ ...newProject, description: e.target.value })} placeholder="Description (optional)" className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm w-56" />
                <button onClick={createProject} className="bg-indigo-600 hover:bg-indigo-500 rounded-xl px-4 py-2.5 text-sm font-bold flex items-center gap-1.5"><Plus size={16} /> Create &amp; open</button>
              </div>
            </div>
            {!projects.length && <div className="border border-dashed border-white/15 rounded-2xl p-10 text-center text-zinc-400 mt-5">No projects yet — create your first one above.</div>}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
              {projects.map(p => <div key={p.id} className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 hover:border-indigo-400/50 transition">
                <div className="flex items-start justify-between"><Film className="text-indigo-300" /><button onClick={() => deleteProject(p)} className="text-zinc-500 hover:text-red-300" title="Delete project"><Trash2 size={16} /></button></div>
                <h3 className="font-bold text-lg mt-3">{p.name}</h3><p className="text-sm text-zinc-400 line-clamp-2 min-h-10">{p.description || '—'}</p>
                <div className="flex items-center justify-between mt-4"><span className="text-xs text-zinc-500">{new Date(p.created_at).toLocaleDateString()}</span><button onClick={() => openProject(p.id)} className="bg-indigo-600/20 text-indigo-200 hover:bg-indigo-600 hover:text-white text-sm font-bold px-4 py-2 rounded-lg">Open in editor →</button></div>
              </div>)}
            </div>
          </section>

          <section className="grid md:grid-cols-3 gap-4 mt-10">
            {[
              { i: <Layers className="text-indigo-300" />, t: 'Array-backed timeline', d: 'Clips live in one list: O(1) playhead lookup, O(n) insert/delete shifts. Includes a doubly linked list implementation so you can compare — O(1) splice, but O(n) indexing. Small n ⇒ array wins.' },
              { i: <Undo2 className="text-sky-300" />, t: 'Stacks for undo / redo', d: 'Every edit pushes a deep-copy snapshot. Undo pops LIFO — the order humans expect. Trade-off: O(n) memory per step vs. fragile hand-written inverse commands. Snapshots are obviously correct.' },
              { i: <ListVideo className="text-amber-300" />, t: 'FIFO render queue', d: 'Renders are expensive, so jobs run one at a time in submission order (collections.deque, O(1) popleft). One replaceable encode_video() calls ffmpeg via subprocess — or clearly simulates.' },
            ].map(c => <div key={c.t} className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">{c.i}<h3 className="font-bold text-lg mt-3">{c.t}</h3><p className="text-sm text-zinc-400 leading-relaxed mt-2">{c.d}</p></div>)}
          </section>

          <section className="bg-[#12151f] border border-white/10 rounded-3xl p-6 md:p-8 mt-6">
            <h2 className="font-black text-xl flex items-center gap-2"><Terminal size={20} className="text-emerald-300" /> Run it locally (5 commands)</h2>
            <pre className="bg-black/50 border border-white/10 rounded-xl p-4 text-sm text-emerald-100 overflow-x-auto mt-4 leading-relaxed">{`python -m venv .venv && source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt                     # Flask only
python app.py                                       # http://127.0.0.1:5000
python -m unittest discover -s tests -v             # 14 tests

# Optional, for REAL encoding only:  install ffmpeg (brew/apt/ffmpeg.org),
# drop source files into uploads/, and encode_video() does the rest.`}</pre>
            <p className="text-sm text-zinc-400 mt-3">Grab every file from the <button className="text-indigo-300 font-bold" onClick={() => setView('source')}>Python Source</button> tab — full contents, copy or download, exactly as they should sit on disk.</p>
          </section>
        </>}

        {/* ================= EDITOR ================= */}
        {view === 'editor' && <>
          <div className="flex flex-wrap items-center gap-3 py-6">
            <h1 className="text-2xl font-black">Editor</h1>
            <select value={projectId ?? ''} onChange={e => openProject(Number(e.target.value))} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm font-semibold">
              {projects.map(p => <option key={p.id} value={p.id} className="bg-zinc-900">{p.name}</option>)}
            </select>
            <div className="flex items-center gap-2 ml-auto text-xs text-zinc-400"><Keyboard size={15} /> Ctrl+Z undo · Ctrl+Y redo · Space play/pause · drag clips to reorder</div>
          </div>

          {!projects.length && <div className="border border-dashed border-white/15 rounded-2xl p-10 text-center text-zinc-400">No project yet. <button onClick={() => setView('home')} className="text-indigo-300 font-bold">Create one on Home →</button></div>}

          {!!projects.length && <div className="grid xl:grid-cols-[290px_1fr_310px] gap-5 items-start">
            {/* Media library */}
            <aside className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
              <h2 className="font-bold flex items-center gap-2"><Film size={17} className="text-indigo-300" /> Media library</h2>
              <p className="text-xs text-zinc-500 mt-1">Sample media is metadata-only here. In Flask: place real files in <code>uploads/</code> with these names + ffmpeg for real renders.</p>
              <div className="space-y-2 mt-3 max-h-[380px] overflow-y-auto pr-1">
                {media.map(m => <div key={m.id} className="flex items-center gap-2.5 bg-black/30 border border-white/5 rounded-xl p-2.5">
                  <span className="w-9 h-9 rounded-lg shrink-0" style={{ background: m.color }} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate">{m.name}</div><div className="text-[11px] text-zinc-500 truncate">{m.filename} · {Number(m.duration_sec)}s · {m.format} · {m.resolution} · {Number(m.size_mb)} MB</div></div>
                  <button disabled={busy} onClick={() => addFromMedia(m)} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg px-2.5 py-1.5 text-xs font-bold shrink-0">+ Add</button>
                </div>)}
              </div>
              <div className="border-t border-white/10 mt-4 pt-4">
                <h3 className="text-sm font-bold">Add your own clip</h3>
                <input value={custom.name} onChange={e => setCustom({ ...custom, name: e.target.value })} placeholder="Clip name *" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mt-2" />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input type="number" min={1} max={600} value={custom.duration} onChange={e => setCustom({ ...custom, duration: e.target.value })} placeholder="Seconds" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
                  <select value={custom.format} onChange={e => setCustom({ ...custom, format: e.target.value })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">{['mp4', 'mov', 'webm', 'mkv', 'avi'].map(f => <option key={f} className="bg-zinc-900">{f}</option>)}</select>
                </div>
                <button disabled={busy} onClick={addCustom} className="w-full bg-white/10 hover:bg-white/15 disabled:opacity-40 rounded-lg py-2.5 text-sm font-bold mt-2 flex items-center justify-center gap-1.5"><Plus size={15} /> Add to library + timeline</button>
                <p className="text-[11px] text-zinc-500 mt-2">Validation: name required, 1–600s, format must be a known container. Try an empty name or 9999s to see graceful errors.</p>
              </div>
            </aside>

            {/* Preview + timeline */}
            <section className="space-y-5 min-w-0">
              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-between"><h2 className="font-bold flex items-center gap-2"><MonitorPlay size={17} className="text-sky-300" /> Preview — current sequence</h2><span className="font-mono text-sm text-zinc-300">{fmtT(playhead)} / {fmtT(total)}</span></div>
                <div className="rounded-2xl mt-3 h-56 flex flex-col items-center justify-center relative overflow-hidden transition-colors" style={{ background: currentClip ? `linear-gradient(135deg, ${currentClip.clip.color}55, #0b0d14 70%)` : '#11141e' }}>
                  {currentClip ? <>
                    <div className="text-[11px] tracking-[0.25em] text-zinc-400 font-bold">NOW PLAYING · CLIP {sorted.findIndex(c => c.id === currentClip.clip.id) + 1} OF {sorted.length}</div>
                    <div className="text-3xl font-black mt-2 px-4 text-center">{currentClip.clip.name}</div>
                    <div className="text-sm text-zinc-300 mt-1 font-mono">{currentClip.clip.source} · +{currentClip.offset.toFixed(1)}s into clip · trimmed {Number(currentClip.clip.trim_start)}–{Number(currentClip.clip.trim_end)}s</div>
                    <div className="flex items-end gap-1 mt-5 h-10">{Array.from({ length: 36 }).map((_, i) => <span key={i} className={`w-1.5 rounded ${playing ? 'animate-pulse' : ''}`} style={{ height: `${8 + Math.abs(Math.sin(i * 1.7)) * 30}px`, background: currentClip.clip.color, opacity: 0.5 + Math.abs(Math.sin(i)) * 0.5 }} />)}</div>
                  </> : <div className="text-zinc-500 text-center px-6">Timeline is empty.<br />Add a clip from the media library to preview the sequence.</div>}
                </div>
                <input type="range" min={0} max={Math.max(0.1, total)} step={0.1} value={playhead} onChange={e => setPlayhead(Number(e.target.value))} className="w-full accent-indigo-500 mt-3" disabled={!sorted.length} />
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => { setPlayhead(0); setPlaying(false); }} className="bg-white/10 rounded-lg p-2" title="Back to start"><SkipBack size={16} /></button>
                  <button onClick={() => { if (playhead >= total) setPlayhead(0); setPlaying(p => !p); }} disabled={!sorted.length} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg px-4 py-2 font-bold text-sm flex items-center gap-1.5">{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? 'Pause' : 'Play'}</button>
                  <span className="text-xs text-zinc-500 ml-auto flex items-center gap-3"><span className="flex items-center gap-1"><Clock3 size={13} /> {total.toFixed(1)}s</span><span className="flex items-center gap-1"><HardDrive size={13} /> ~{estMB} MB @ {exportRes}</span><span>{sorted.length} clips</span></span>
                </div>
              </div>

              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-bold flex items-center gap-2 mr-1"><Layers size={17} className="text-indigo-300" /> Timeline <span className="text-[11px] font-semibold text-zinc-500">array-backed list · index = position</span></h2>
                  <button disabled={!undoStack.length || busy} onClick={doUndo} className="bg-white/10 hover:bg-white/15 disabled:opacity-35 rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-1.5"><Undo2 size={15} /> Undo ({undoStack.length})</button>
                  <button disabled={!redoStack.length || busy} onClick={doRedo} className="bg-white/10 hover:bg-white/15 disabled:opacity-35 rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-1.5"><Redo2 size={15} /> Redo ({redoStack.length})</button>
                  <span className="ml-auto flex gap-1.5">
                    <button disabled={!selected || busy} onClick={() => moveSelected(-1)} className="bg-white/10 disabled:opacity-35 rounded-lg p-2" title="Move left (index −1)"><ChevronLeft size={16} /></button>
                    <button disabled={!selected || busy} onClick={() => moveSelected(1)} className="bg-white/10 disabled:opacity-35 rounded-lg p-2" title="Move right (index +1)"><ChevronRight size={16} /></button>
                    <button disabled={!selected || busy} onClick={splitSelected} className="bg-white/10 disabled:opacity-35 rounded-lg px-2.5 py-2 text-xs font-bold flex items-center gap-1"><Split size={14} /> Split</button>
                    <button disabled={!selected || busy} onClick={joinSelected} className="bg-white/10 disabled:opacity-35 rounded-lg px-2.5 py-2 text-xs font-bold flex items-center gap-1"><Merge size={14} /> Join next</button>
                    <button disabled={!selected || busy} onClick={() => selected && removeClip(selected)} className="bg-red-500/20 text-red-200 disabled:opacity-35 rounded-lg px-2.5 py-2 text-xs font-bold flex items-center gap-1"><Trash2 size={14} /> Delete</button>
                  </span>
                </div>

                {/* ruler */}
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-4 px-0.5"><span>00:00</span><span>{fmtT(total / 2)}</span><span>{fmtT(total)}</span></div>
                <div className="relative mt-1">
                  <div className="flex gap-1.5 min-h-[92px] bg-black/40 border border-white/5 rounded-xl p-2 overflow-x-auto">
                    {!sorted.length && <div className="text-zinc-500 text-sm m-auto text-center py-6">Empty list — <span className="font-mono">timeline = []</span><br />Add clips from the library; each append is amortised O(1).</div>}
                    {sorted.map((c, i) => <div key={c.id} draggable onDragStart={() => setDragIdx(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragIdx === null || dragIdx === i) return; const order = [...sorted]; const [x] = order.splice(dragIdx, 1); order.splice(i, 0, x); setDragIdx(null); reorderTo(order, `Move “${x.name}” ${dragIdx} → ${i}`); }}
                      onClick={() => setSelectedId(c.id)} className={`rounded-xl p-2.5 cursor-grab shrink-0 relative text-left transition ${selectedId === c.id ? 'ring-2 ring-white' : 'ring-1 ring-black/40'}`} style={{ background: c.color, width: `${Math.max(96, eff(c) * 16)}px`, maxWidth: 320 }}>
                      <div className="flex items-center gap-1 text-[10px] font-black opacity-80"><GripVertical size={11} /> [{i}]</div>
                      <div className="font-bold text-sm truncate mt-0.5">{c.name}</div>
                      <div className="text-[11px] opacity-85 font-mono truncate">{eff(c).toFixed(1)}s · {Number(c.trim_start)}–{Number(c.trim_end)} / {Number(c.duration_sec)}s</div>
                      <div className="flex items-end gap-[3px] h-4 mt-1.5 opacity-70">{Array.from({ length: 14 }).map((_, k) => <span key={k} className="w-1 bg-white rounded" style={{ height: `${4 + Math.abs(Math.sin(k * 2 + i)) * 12}px` }} />)}</div>
                    </div>)}
                  </div>
                  {sorted.length > 0 && <div className="absolute top-0 bottom-0 w-[2px] bg-red-400 pointer-events-none" style={{ left: `calc(${(total ? playhead / total : 0) * 100}% )` }}><span className="absolute -top-1 -left-[5px] w-3 h-3 bg-red-400 rounded-full" /></div>}
                </div>

                {/* trim panel */}
                {selected ? <div className="bg-black/30 border border-white/10 rounded-xl p-4 mt-4">
                  <h3 className="font-bold text-sm flex items-center gap-2"><Scissors size={15} className="text-pink-300" /> Trim “{selected.name}” <span className="text-zinc-500 font-semibold">— source {Number(selected.duration_sec)}s · currently {eff(selected).toFixed(1)}s</span></h3>
                  <div className="grid md:grid-cols-2 gap-4 mt-3">
                    <label className="text-xs text-zinc-400 font-bold">IN — {trimStart.toFixed(1)}s<input type="range" min={0} max={Number(selected.duration_sec)} step={0.1} value={trimStart} onChange={e => setTrimStart(Number(e.target.value))} className="w-full accent-pink-500 mt-1.5" /></label>
                    <label className="text-xs text-zinc-400 font-bold">OUT — {trimEnd.toFixed(1)}s<input type="range" min={0} max={Number(selected.duration_sec)} step={0.1} value={trimEnd} onChange={e => setTrimEnd(Number(e.target.value))} className="w-full accent-pink-500 mt-1.5" /></label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className={`text-sm font-bold ${trimEnd - trimStart >= 0.5 && trimStart >= 0 && trimEnd <= Number(selected.duration_sec) ? 'text-emerald-300' : 'text-red-300'}`}>Result: {Math.max(0, trimEnd - trimStart).toFixed(1)}s {trimEnd - trimStart < 0.5 ? '— too short, Apply will explain why' : ''}</span>
                    <button disabled={busy} onClick={applyTrim} className="ml-auto bg-pink-600 hover:bg-pink-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-bold">Apply trim</button>
                    <button onClick={() => { setTrimStart(0); setTrimEnd(Number(selected.duration_sec)); }} className="bg-white/10 rounded-lg px-3 py-2 text-sm font-bold">Reset to full</button>
                  </div>
                </div> : <p className="text-xs text-zinc-500 mt-3">Click a clip block to select it — move, split, join, delete and trim controls apply to the selection. Drag blocks to reorder (splice out + splice in, O(n)).</p>}
              </div>

              {/* history stacks visual */}
              <div className="grid md:grid-cols-2 gap-4">
                {[['Undo stack (LIFO)', undoStack, 'bg-sky-500/15 border-sky-500/25 text-sky-200'], ['Redo stack (LIFO)', redoStack, 'bg-violet-500/15 border-violet-500/25 text-violet-200']].map(([t, stack, cls]) => <div key={t as string} className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                  <h3 className="font-bold text-sm">{t as string} <span className="text-zinc-500">depth {(stack as HistEntry[]).length} · top = last pushed</span></h3>
                  <div className="space-y-1.5 mt-3">{(stack as HistEntry[]).length ? [...(stack as HistEntry[])].reverse().slice(0, 5).map((h, i) => <div key={i} className={`border rounded-lg px-3 py-1.5 text-xs font-semibold ${cls} ${i === 0 ? '' : 'opacity-50'}`}>{i === 0 ? 'TOP → ' : ''}{h.label} <span className="opacity-60">({h.snapshot.length} clips)</span></div>) : <div className="text-xs text-zinc-500 border border-dashed border-white/10 rounded-lg px-3 py-2">empty — pop() returns “nothing to do”</div>}</div>
                </div>)}
              </div>
            </section>

            {/* Render queue */}
            <aside className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
              <h2 className="font-bold flex items-center gap-2"><ListVideo size={17} className="text-amber-300" /> Render queue <span className="text-[11px] text-zinc-500 font-semibold">FIFO · deque</span></h2>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <select value={exportFmt} onChange={e => setExportFmt(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-sm">{['mp4', 'mov', 'webm'].map(f => <option key={f} className="bg-zinc-900">{f}</option>)}</select>
                <select value={exportRes} onChange={e => setExportRes(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-sm">{['720p', '1080p', '4K'].map(f => <option key={f} className="bg-zinc-900">{f}</option>)}</select>
              </div>
              <button onClick={enqueueJob} className="w-full bg-amber-500 hover:bg-amber-400 text-black rounded-lg py-2.5 text-sm font-black mt-2">Enqueue export (push back)</button>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button disabled={processing} onClick={() => processQueue(false)} className="bg-white/10 disabled:opacity-40 rounded-lg py-2 text-xs font-bold">Process next (pop front)</button>
                <button disabled={processing} onClick={() => processQueue(true)} className="bg-white/10 disabled:opacity-40 rounded-lg py-2 text-xs font-bold">Process all</button>
              </div>
              <div className="space-y-2 mt-4">
                {!jobs.length && <div className="text-xs text-zinc-500 border border-dashed border-white/10 rounded-lg p-3 text-center">Queue is empty.</div>}
                {jobs.map((j, i) => <div key={j.id} className="bg-black/30 border border-white/5 rounded-xl p-3">
                  <div className="flex items-center gap-2"><span className="text-[10px] font-black bg-white/10 rounded px-1.5 py-0.5">#{j.id}{j.status === 'queued' ? ` · pos ${jobs.filter(x => x.status === 'queued').findIndex(x => x.id === j.id)}` : ''}</span><span className="text-sm font-semibold truncate flex-1">{j.name}</span>
                    {j.status === 'queued' && <button onClick={() => cancelJob(j)} title="Cancel" className="text-zinc-500 hover:text-red-300"><Ban size={14} /></button>}
                    <button onClick={() => deleteJob(j)} title="Remove" className="text-zinc-500 hover:text-red-300"><Trash2 size={14} /></button></div>
                  <div className="text-[11px] text-zinc-500 mt-1">{j.resolution} · {j.format} · <span className={j.status === 'done' ? 'text-emerald-300' : j.status === 'rendering' ? 'text-amber-300' : j.status === 'cancelled' ? 'text-red-300' : ''}>{j.status}</span>{j.status === 'rendering' ? ` · ${j.progress}%` : ''}</div>
                  {(j.status === 'rendering' || j.status === 'done') && <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden"><div className="h-full bg-amber-400 transition-all" style={{ width: `${j.progress}%` }} /></div>}
                  {i === 0 && j.status === 'queued' && <div className="text-[10px] text-amber-300 font-bold mt-1.5">← FRONT of queue (next to run)</div>}
                </div>)}
              </div>
              <button onClick={clearFinished} className="w-full text-zinc-400 hover:text-white text-xs font-bold mt-3 flex items-center justify-center gap-1.5"><Eraser size={13} /> Clear finished / cancelled</button>
              <div className="bg-black/40 border border-white/10 rounded-xl p-3 mt-4">
                <div className="text-[11px] font-black text-amber-300">encode_video() — THE REPLACEABLE STEP</div>
                <pre className="text-[11px] text-zinc-300 overflow-x-auto mt-2 leading-relaxed">{`# editor/render_queue.py
if ffmpeg missing or file missing:
    simulate + say why  # never silent
else:
    ffmpeg -ss s -to e -i in -c copy  # trim
    ffmpeg -f concat ...              # join`}</pre>
              </div>
            </aside>
          </div>}
        </>}

        {/* ================= SOURCE ================= */}
        {view === 'source' && <section className="py-8">
          <h1 className="text-3xl font-black">Python + Flask source pack</h1>
          <p className="text-zinc-400 mt-2 max-w-3xl">The complete, runnable local application. Recreate this folder structure, save each file with the contents below, then follow the README. Total install footprint: Flask. Real rendering additionally needs <b className="text-zinc-200">ffmpeg on PATH</b> (or <code>pip install moviepy</code> — see the marked stub).</p>
          <div className="grid lg:grid-cols-[300px_1fr] gap-5 mt-6 items-start">
            <div className="space-y-4">
              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                <h2 className="font-bold text-sm flex items-center gap-2"><FolderTree size={16} className="text-indigo-300" /> Folder structure</h2>
                <pre className="text-[11px] text-zinc-300 overflow-x-auto mt-3 leading-relaxed">{FOLDER_TREE}</pre>
              </div>
              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3 space-y-1">
                {PYTHON_FILES.map((f, i) => <button key={f.path} onClick={() => setSrcIdx(i)} className={`w-full text-left rounded-lg px-3 py-2 text-sm ${i === srcIdx ? 'bg-indigo-600' : 'hover:bg-white/10'}`}><span className="font-mono font-semibold block">{f.path}</span><span className={`text-[11px] block ${i === srcIdx ? 'text-indigo-100' : 'text-zinc-500'}`}>{f.purpose}</span></button>)}
                <button onClick={() => downloadText('cutstudio-all-files.txt', PYTHON_FILES.map(f => `\n${'='.repeat(72)}\nFILE: ${f.path}\n${'='.repeat(72)}\n\n${f.content}`).join('\n'))} className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2 mt-2"><Download size={15} /> Download all files (.txt bundle)</button>
              </div>
            </div>
            <div className="bg-[#0d1018] border border-white/10 rounded-2xl overflow-hidden min-w-0">
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
                <FileCode2 size={16} className="text-indigo-300" /><span className="font-mono font-bold text-sm">{srcFile.path}</span>
                <span className="text-[11px] text-zinc-500">{srcFile.content.split('\n').length} lines · {srcFile.lang}</span>
                <span className="ml-auto flex gap-2">
                  <button onClick={async () => { await navigator.clipboard.writeText(srcFile.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="bg-white/10 rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1.5">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button>
                  <button onClick={() => downloadText(srcFile.path.split('/').pop() || 'file.txt', srcFile.content)} className="bg-indigo-600 rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"><Download size={13} /> Download</button>
                </span>
              </div>
              <pre className="p-5 text-[12.5px] leading-relaxed overflow-auto max-h-[720px] text-zinc-200">{srcFile.content}</pre>
            </div>
          </div>
        </section>}

        {/* ================= TESTS ================= */}
        {view === 'tests' && <section className="py-8 max-w-4xl">
          <h1 className="text-3xl font-black">Core-structure tests</h1>
          <p className="text-zinc-400 mt-2">The same cases as <code className="text-zinc-200">tests/test_timeline.py</code>, executed here against the TypeScript mirror of the Python classes (<code className="text-zinc-200">src/lib/timeline.ts</code>). Insert, delete, move, undo, redo, trim validation, join and FIFO order.</p>
          <button onClick={() => setTests(runTimelineTests())} className="bg-emerald-600 hover:bg-emerald-500 px-5 py-3 rounded-xl font-bold mt-5 flex items-center gap-2"><FlaskConical size={17} /> Run all tests</button>
          <span className="text-sm text-zinc-500 ml-3 font-mono">≈ python -m unittest discover -s tests -v</span>
          {tests && <div className="mt-6">
            <div className={`rounded-2xl border px-5 py-4 font-bold ${tests.every(t => t.pass) ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-red-500/10 border-red-500/30 text-red-200'}`}>{tests.filter(t => t.pass).length} / {tests.length} passed</div>
            <div className="space-y-2 mt-4">{tests.map((t, i) => <div key={i} className="flex gap-3 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3">{t.pass ? <CheckCircle2 className="text-emerald-300 shrink-0 mt-0.5" size={18} /> : <XCircle className="text-red-300 shrink-0 mt-0.5" size={18} />}<div><div className="font-semibold text-sm">{t.name}</div><div className="text-xs text-zinc-400 mt-0.5 font-mono">{t.detail}</div></div><span className={`ml-auto text-[11px] font-black ${t.pass ? 'text-emerald-300' : 'text-red-300'}`}>{t.pass ? 'PASS' : 'FAIL'}</span></div>)}</div>
          </div>}
          {!tests && <div className="border border-dashed border-white/15 rounded-2xl p-8 text-zinc-500 text-sm mt-6">Not run yet. Each test builds a fresh TimelineList / HistoryStacks / RenderQueue, mutates it, and asserts the result — including the failure paths (out-of-range indices and trims must raise).</div>}
        </section>}

        {/* ================= DOCS ================= */}
        {view === 'docs' && <section className="py-8 max-w-5xl space-y-6">
          <h1 className="text-3xl font-black">Design notes &amp; docs</h1>
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-left text-zinc-400 border-b border-white/10">{['Operation', 'Array-backed list ✓ (chosen)', 'Doubly linked list', 'Verdict'].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>{[
                ['Get clip at index i (playhead)', 'O(1) — pointer arithmetic', 'O(n) — walk from head', 'Array: editors index constantly'],
                ['Append clip', 'O(1) amortised', 'O(1) with tail pointer', 'Tie'],
                ['Insert / delete in middle', 'O(n) memmove shift (very fast in C)', 'O(1) splice once node is held… but finding it is O(n)', 'Tie in Big-O, array simpler & cache-friendly'],
                ['Move i → j', 'O(n) remove + insert', 'O(n) to locate both nodes', 'Array'],
                ['Memory per clip', 'One pointer slot', 'Pointer slot + prev + next', 'Array'],
              ].map(r => <tr key={r[0]} className="border-b border-white/5">{r.map((c, i) => <td key={i} className={`px-4 py-3 ${i === 0 ? 'font-semibold' : 'text-zinc-400'}`}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              ['Stacks for undo/redo — why LIFO?', 'Undo must reverse the most recent edit first; redo replays in the opposite order. Two stacks model this exactly. We push a deep-copy SNAPSHOT before each mutation (validate → record → mutate). Trade-off: O(n) memory per edit, capped at 100, vs. inverse-command histories that need a hand-written inverse per operation — the #1 source of undo bugs. A fresh edit clears the redo stack, because the “future” it described no longer exists.'],
              ['Queue for renders — why FIFO?', 'Encoding saturates a CPU, so jobs run strictly one at a time, first-come-first-served. collections.deque gives O(1) append + O(1) popleft (list.pop(0) would shift everything, O(n)). Trade-off: no priorities — a 4K job blocks later jobs. A heapq priority queue is the documented upgrade path, at the cost of surprising order and possible starvation.'],
              ['Media manipulation — the honest stub', 'Requirement for REAL output: ffmpeg on PATH (+ source files in uploads/). encode_video() in editor/render_queue.py trims each clip with ffmpeg -ss/-to via subprocess, then joins with the concat demuxer; a 4-line moviepy alternative is in its docstring. If ffmpeg or files are missing it simulates progress, writes a placeholder, and RETURNS A MESSAGE SAYING SO. Simulating silently would be lying to the user.'],
              ['Error handling — never a stack trace', 'Empty name → rejected in Clip.__post_init__. Trim outside [0, duration] or < 0.5s → TimelineError with the rule spelled out. Bad index → range message. Empty timeline export → refused at enqueue. Non-JSON body / non-numeric duration → 400 with an example. Flask\'s errorhandler turns all of these into one friendly JSON shape the UI displays. The browser editor here mirrors every rule — try breaking it.'],
              ['State & persistence trade-off', 'The Flask version keeps state in memory: zero setup, perfect for a single-user local teaching tool — restart loses the edit (stated in app.py). The hosted studio you are using now persists projects, clips, media and jobs in Postgres via /api routes, so your timelines survive reloads. Swapping Flask to sqlite only touches app.py + timeline.py.'],
              ['How to extend (good first issues)', '1) Multi-track timelines (list of Timelines). 2) Persist to sqlite with the same API. 3) Real thumbnails via ffmpeg -vf thumbnail. 4) Priority render queue with heapq. 5) Command-based history to cut memory on huge timelines. 6) WebSocket progress instead of the simulated steps. Each maps to one data-structure idea you now understand.'],
            ].map(([t, d]) => <div key={t} className="bg-white/[0.04] border border-white/10 rounded-2xl p-6"><h2 className="font-bold">{t}</h2><p className="text-sm text-zinc-400 leading-relaxed mt-2">{d}</p></div>)}
          </div>
        </section>}
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-zinc-500">CutStudio — array timeline · stack history · FIFO render queue · one replaceable encode_video(). Built to be read.</footer>
    </div>
  );
}
