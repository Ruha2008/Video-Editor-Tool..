// Core data structures for CutStudio - TypeScript mirror of editor/timeline.py
// Timeline = ARRAY-BACKED LIST: clips live in one contiguous array.
//   Why: O(1) indexed access for the playhead/preview, simple + cache-friendly; timelines are small (tens-hundreds of clips).
//   Trade-off: insert/delete/move shift elements => O(n). A doubly linked list gives O(1) splice once you hold the node,
//   but O(n) to find index i, no random access, more pointer bugs. For an editor UI that constantly indexes by position, array wins.
export interface ClipLike { id: number; name: string; duration: number; trimStart: number; trimEnd: number; }
export const eff = (c: ClipLike) => Math.max(0, c.trimEnd - c.trimStart);

export class TimelineList {
  items: ClipLike[] = []; // the backing array
  insert(index: number, clip: ClipLike) { // O(n) shift right - acceptable for small n
    if (index < 0 || index > this.items.length) throw new Error('Insert index out of range: ' + index);
    this.items.splice(index, 0, clip);
  }
  append(clip: ClipLike) { this.items.push(clip); } // amortised O(1)
  removeAt(index: number): ClipLike { // O(n) shift left
    if (index < 0 || index >= this.items.length) throw new Error('Delete index out of range: ' + index);
    return this.items.splice(index, 1)[0];
  }
  move(from: number, to: number) { // remove + insert = O(n); preserves relative order of all other clips
    if (from < 0 || from >= this.items.length || to < 0 || to >= this.items.length) throw new Error('Move index out of range');
    const [c] = this.items.splice(from, 1); this.items.splice(to, 0, c);
  }
  trim(index: number, start: number, end: number) {
    const c = this.items[index]; if (!c) throw new Error('No clip at index ' + index);
    if (start < 0 || end > c.duration || end - start < 0.5) throw new Error('Invalid trim: need 0 <= start < end <= duration, min 0.5s');
    c.trimStart = start; c.trimEnd = end;
  }
  join(index: number) { // merge clip[index] with clip[index+1] into one clip
    if (index < 0 || index + 1 >= this.items.length) throw new Error('Join needs a following clip');
    const a = this.items[index], b = this.items[index + 1];
    const merged: ClipLike = { id: a.id, name: a.name + ' + ' + b.name, duration: eff(a) + eff(b), trimStart: 0, trimEnd: eff(a) + eff(b) };
    this.items.splice(index, 2, merged);
  }
  totalDuration() { return this.items.reduce((s, c) => s + eff(c), 0); } // O(n) scan - fine, called on render
  snapshot(): ClipLike[] { return JSON.parse(JSON.stringify(this.items)); } // deep copy so history is immutable
  restore(s: ClipLike[]) { this.items = JSON.parse(JSON.stringify(s)); }
}

// Undo/Redo = TWO STACKS (LIFO). Why stacks: the most recent edit must be undone first - exactly LIFO order.
// Trade-off: snapshot-per-edit costs O(n) memory per step; a command/inverse-op history is leaner but far more bug-prone for students.
export class HistoryStacks {
  undoStack: ClipLike[][] = []; redoStack: ClipLike[][] = [];
  push(state: ClipLike[]) { this.undoStack.push(JSON.parse(JSON.stringify(state))); this.redoStack = []; } // new edit kills the redo future
  undo(current: ClipLike[]): ClipLike[] | null { const prev = this.undoStack.pop(); if (!prev) return null; this.redoStack.push(JSON.parse(JSON.stringify(current))); return prev; }
  redo(current: ClipLike[]): ClipLike[] | null { const next = this.redoStack.pop(); if (!next) return null; this.undoStack.push(JSON.parse(JSON.stringify(current))); return next; }
}

// Render queue = FIFO QUEUE. Why: renders are expensive, must run one-at-a-time in submission order - fairness = FIFO.
// Trade-off: JS Array.shift() is O(n); Python version uses collections.deque for O(1) popleft. Queue sizes here are tiny, so array is fine.
export class RenderQueue<T> {
  private q: T[] = [];
  enqueue(x: T) { this.q.push(x); }
  dequeue(): T | undefined { return this.q.shift(); }
  peek(): T | undefined { return this.q[0]; }
  get size() { return this.q.length; }
  toArray() { return [...this.q]; }
}

export interface TestResult { name: string; pass: boolean; detail: string; }
export function runTimelineTests(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, fn: () => string) => { try { results.push({ name, pass: true, detail: fn() }); } catch (e: any) { results.push({ name, pass: false, detail: e.message }); } };
  const mk = (id: number, name: string, d = 10): ClipLike => ({ id, name, duration: d, trimStart: 0, trimEnd: d });
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

  check('insert: append + insert at index preserves order', () => { const t = new TimelineList(); t.append(mk(1,'A')); t.append(mk(3,'C')); t.insert(1, mk(2,'B')); assert(t.items.map(c=>c.name).join(',')==='A,B,C','order '+t.items.map(c=>c.name)); return 'A,B,C as expected'; });
  check('insert: out-of-range index raises a clear error', () => { const t = new TimelineList(); let threw=false; try{ t.insert(5, mk(1,'X')); }catch{ threw=true; } assert(threw,'should have thrown'); return 'IndexError-style guard fired'; });
  check('delete: removeAt returns clip and shifts the rest left', () => { const t=new TimelineList(); [mk(1,'A'),mk(2,'B'),mk(3,'C')].forEach(c=>t.append(c)); const r=t.removeAt(1); assert(r.name==='B' && t.items.map(c=>c.name).join(',')==='A,C','bad delete'); return 'removed B, left A,C'; });
  check('delete: removing from empty timeline raises', () => { const t=new TimelineList(); let threw=false; try{ t.removeAt(0);}catch{threw=true;} assert(threw,'should throw'); return 'guarded'; });
  check('move: move(0 -> 2) rotates correctly', () => { const t=new TimelineList(); [mk(1,'A'),mk(2,'B'),mk(3,'C')].forEach(c=>t.append(c)); t.move(0,2); assert(t.items.map(c=>c.name).join(',')==='B,C,A','got '+t.items.map(c=>c.name)); return 'B,C,A as expected'; });
  check('trim: valid trim shortens effective duration', () => { const t=new TimelineList(); t.append(mk(1,'A',10)); t.trim(0,2,7); assert(eff(t.items[0])===5,'eff should be 5'); return '10s clip trimmed to 5s'; });
  check('trim: out-of-range trim is rejected', () => { const t=new TimelineList(); t.append(mk(1,'A',10)); let threw=false; try{ t.trim(0,8,20);}catch{threw=true;} assert(threw,'end > duration must fail'); return 'rejected end=20 on a 10s clip'; });
  check('join: two adjacent clips merge, durations add', () => { const t=new TimelineList(); t.append(mk(1,'A',6)); t.append(mk(2,'B',4)); t.join(0); assert(t.items.length===1 && eff(t.items[0])===10,'join failed'); return 'A+B = one 10s clip'; });
  check('undo/redo: stacks walk history backwards then forwards', () => { const t=new TimelineList(); const h=new HistoryStacks(); t.append(mk(1,'A')); h.push(t.snapshot()); t.append(mk(2,'B')); const cur=t.snapshot(); const prev=h.undo(cur); assert(prev!==null && prev.length===1,'undo should return 1-clip state'); t.restore(prev!); const fwd=h.redo(t.snapshot()); assert(fwd!==null && fwd.length===2,'redo should return 2-clip state'); return 'undo -> [A], redo -> [A,B]'; });
  check('undo: a fresh edit clears the redo stack', () => { const h=new HistoryStacks(); h.push([mk(1,'A')]); h.undo([mk(1,'A'),mk(2,'B')]); assert(h.redoStack.length===1,'redo should hold future'); h.push([mk(1,'A')]); assert(h.redoStack.length===0,'redo must be cleared by new edit'); return 'redo future discarded on new edit'; });
  check('queue: renders dequeue in FIFO order', () => { const q=new RenderQueue<string>(); q.enqueue('job1'); q.enqueue('job2'); q.enqueue('job3'); assert(q.dequeue()==='job1' && q.dequeue()==='job2' && q.peek()==='job3','FIFO broken'); return 'job1, job2, then job3 waiting'; });
  check('total duration: sums effective (trimmed) lengths', () => { const t=new TimelineList(); t.append(mk(1,'A',10)); t.append(mk(2,'B',8)); t.trim(1,0,3); assert(t.totalDuration()===13,'got '+t.totalDuration()); return '10 + 3 = 13s'; });
  return results;
}
