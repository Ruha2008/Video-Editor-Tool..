// The complete self-contained Python + Flask project, embedded for viewing / copy / download.
// Save these files with the folder structure shown, then follow README.md.
export interface SourceFile { path: string; lang: string; purpose: string; content: string; }

const README = `CutStudio - a local Video Editor Tool (Python + Flask)
=====================================================

A complete, runnable, self-contained local web application. No database,
no JavaScript build step, no heavy dependencies - just Flask.

----------------------------------------------------------------------
REQUIREMENTS
----------------------------------------------------------------------
  * Python 3.10 or newer          (python --version)
  * Flask                         (installed below via pip)
  * ffmpeg  - ONLY needed for real encoding (optional for learning)
        macOS:    brew install ffmpeg
        Ubuntu:   sudo apt install ffmpeg
        Windows:  download from https://ffmpeg.org and add to PATH
    Without ffmpeg the app still runs fully: timeline, undo/redo and the
    render queue all work, and encode_video() in editor/render_queue.py
    runs in SIMULATION mode, clearly marked, ready to swap in ffmpeg.

----------------------------------------------------------------------
INSTALL AND RUN  (from the project root)
----------------------------------------------------------------------
    python -m venv .venv
    source .venv/bin/activate        (Windows:  .venv\\Scripts\\activate)
    pip install -r requirements.txt
    python app.py

Then open http://127.0.0.1:5000 in your browser.

Optional real rendering with moviepy instead of raw ffmpeg:
    pip install moviepy
and replace the body of encode_video() as shown in its docstring.

----------------------------------------------------------------------
RUN THE TESTS
----------------------------------------------------------------------
    python -m unittest discover -s tests -v
    (or simply:  python tests/test_timeline.py -v)

----------------------------------------------------------------------
FOLDER STRUCTURE
----------------------------------------------------------------------
    cutstudio/
      app.py                  Flask routes + JSON API + error handling
      requirements.txt        Flask only
      README.md               this file
      editor/
        __init__.py
        timeline.py           Clip + Timeline (array-backed list) + DLL note
        history.py            Undo/redo (two stacks)
        render_queue.py       FIFO render queue + encode_video() stub
      templates/
        index.html            homepage
        editor.html           editor interface (timeline, preview, queue)
      static/
        style.css
      uploads/                put your source video files here
      exports/                finished renders are written here
      tests/
        test_timeline.py      unittest: insert/delete/move/undo/redo/...

----------------------------------------------------------------------
HOW IT WORKS (the 30-second tour)
----------------------------------------------------------------------
  * Timeline clips live in ONE Python list (array-backed). O(1) access
    by index for the playhead; insert/delete are O(n) shifts - fine for
    the tens-to-hundreds of clips in a real edit. timeline.py also
    includes a small DoublyLinkedList so you can compare trade-offs.
  * Every edit pushes a deep-copy snapshot onto an undo STACK. Undo pops
    it and pushes the current state onto the redo stack. LIFO is exactly
    the order humans expect: most recent edit is undone first.
  * Export jobs go into a FIFO QUEUE (collections.deque, O(1) popleft).
    A worker pops the front job and calls encode_video().
  * encode_video() is the ONE replaceable function for real media work.
    It shells out to ffmpeg via subprocess (concat demuxer + trim), or
    simulates progress when ffmpeg/files are missing - and says so.
  * All invalid input (missing file, trim outside the clip, bad index,
    empty name) returns a friendly message, never a stack trace, to the
    browser. See the try/except + validation in app.py and timeline.py.
`;

const REQUIREMENTS = `Flask>=3.0
# Optional - uncomment if you prefer moviepy over calling ffmpeg directly:
# moviepy>=1.0
`;

const TIMELINE_PY = `"""Timeline data structure: an ordered list of clips.

DESIGN CHOICE - array-backed list (Python list)
  Why: O(1) indexed access (the playhead/preview asks "clip at position i"
       constantly), dead simple, cache-friendly, and edits involve at most
       a few hundred clips, so the O(n) shift on insert/delete is invisible.
  Trade-off: insert/delete/move in the middle are O(n) element shifts.
       A doubly linked list splices in O(1) once you HOLD the node, but
       finding "index i" costs O(n) pointer-chasing and you lose random
       access. A tiny DoublyLinkedList is included at the bottom so you
       can benchmark both and make the call yourself.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
import copy


class TimelineError(ValueError):
    """Raised for any bad edit (bad index, bad trim, missing clip).
    app.py catches this and shows str(err) to the user - no stack traces."""


@dataclass
class Clip:
    name: str
    source: str            # filename of the original media, e.g. "intro.mp4"
    duration: float        # full length of the source file, seconds
    trim_start: float = 0.0
    trim_end: float = 0.0  # 0 means "to the end" until normalised below

    def __post_init__(self):
        if not self.name.strip():
            raise TimelineError("Clip name must not be empty.")
        if self.duration <= 0:
            raise TimelineError(f"'{self.name}': duration must be positive.")
        if self.trim_end == 0:
            self.trim_end = self.duration
        self.validate_trim(self.trim_start, self.trim_end)

    def validate_trim(self, start: float, end: float) -> None:
        # One place for the trim rule, reused by __init__ and Timeline.trim().
        if start < 0 or end > self.duration or end - start < 0.5:
            raise TimelineError(
                f"'{self.name}': invalid trim {start}s..{end}s for a "
                f"{self.duration}s clip. Need 0 <= start < end <= duration "
                "and at least 0.5s remaining.")

    @property
    def effective_duration(self) -> float:
        """What the viewer actually sees: trim_end - trim_start."""
        return round(self.trim_end - self.trim_start, 3)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["effective_duration"] = self.effective_duration
        return d


class Timeline:
    """Array-backed ordered clip list with insert/delete/move/trim/join."""

    def __init__(self) -> None:
        self._clips: list[Clip] = []   # <-- the backing array

    # -- read helpers ----------------------------------------------------
    def __len__(self) -> int:
        return len(self._clips)

    def clips(self) -> list[Clip]:
        return list(self._clips)       # shallow copy: callers cannot reorder us

    def total_duration(self) -> float:  # O(n) scan - trivial for small n
        return round(sum(c.effective_duration for c in self._clips), 3)

    def snapshot(self) -> list[Clip]:
        """Deep copy for the undo stack, so later edits cannot mutate history."""
        return copy.deepcopy(self._clips)

    def restore(self, snap: list[Clip]) -> None:
        self._clips = copy.deepcopy(snap)

    # -- edits (all validate first, raise TimelineError on bad input) -----
    def _check(self, i: int, allow_end: bool = False) -> None:
        hi = len(self._clips) if allow_end else len(self._clips) - 1
        if not 0 <= i <= hi:
            raise TimelineError(f"Clip index {i} is out of range (0..{hi}).")

    def insert(self, index: int, clip: Clip) -> None:
        """O(n): elements from index onwards shift one place right."""
        self._check(index, allow_end=True)
        self._clips.insert(index, clip)

    def append(self, clip: Clip) -> None:
        self._clips.append(clip)       # amortised O(1)

    def delete(self, index: int) -> Clip:
        """O(n): elements after index shift one place left."""
        self._check(index)
        return self._clips.pop(index)

    def move(self, src: int, dst: int) -> None:
        """Remove + insert, O(n). Relative order of all other clips is kept."""
        self._check(src); self._check(dst)
        self._clips.insert(dst, self._clips.pop(src))

    def trim(self, index: int, start: float, end: float) -> None:
        self._check(index)
        clip = self._clips[index]
        clip.validate_trim(start, end)
        clip.trim_start, clip.trim_end = float(start), float(end)

    def join(self, index: int) -> Clip:
        """Merge clip[index] and clip[index+1] into a single clip.
        The joined clip plays both trimmed regions back-to-back; when you
        wire up ffmpeg this maps to the concat demuxer (see render_queue)."""
        if index < 0 or index + 1 >= len(self._clips):
            raise TimelineError("Join needs a clip followed by another clip.")
        a, b = self._clips[index], self._clips[index + 1]
        merged = Clip(name=f"{a.name} + {b.name}", source=a.source,
                      duration=a.effective_duration + b.effective_duration)
        self._clips[index:index + 2] = [merged]   # slice replace: 2 -> 1
        return merged


# ----------------------------------------------------------------------
# For comparison: a doubly linked list version of the same idea.
#   Splice/insert-next/delete-node are O(1) ONCE you hold the node,
#   but get(index) is O(n) - walk from the head. Editors index by
#   position constantly, which is why Timeline above uses an array.
# ----------------------------------------------------------------------
class _Node:
    __slots__ = ("clip", "prev", "next")
    def __init__(self, clip: Clip):
        self.clip, self.prev, self.next = clip, None, None


class DoublyLinkedList:
    def __init__(self):
        self.head = self.tail = None
        self._len = 0

    def append(self, clip: Clip) -> _Node:      # O(1) thanks to tail pointer
        node = _Node(clip)
        if self.tail is None:
            self.head = self.tail = node
        else:
            node.prev, self.tail.next, self.tail = self.tail, node, node
        self._len += 1
        return node

    def delete_node(self, node: _Node) -> None:  # O(1): rewire two pointers
        if node.prev: node.prev.next = node.next
        else: self.head = node.next
        if node.next: node.next.prev = node.prev
        else: self.tail = node.prev
        self._len -= 1

    def get(self, index: int) -> Clip:           # O(n): the linked-list tax
        if not 0 <= index < self._len:
            raise TimelineError(f"Index {index} out of range.")
        node = self.head
        for _ in range(index):
            node = node.next
        return node.clip

    def __iter__(self):
        node = self.head
        while node:
            yield node.clip
            node = node.next
`;

const HISTORY_PY = `"""Undo / redo history: two stacks of timeline snapshots.

DESIGN CHOICE - a STACK (LIFO list) for each direction
  Why: humans undo the MOST RECENT edit first - that is definitionally
       Last-In-First-Out. push/pop at the end of a Python list are O(1).
  Trade-off: we store a full deep-copy snapshot per edit => O(n) memory
       per step. The lean alternative (store inverse commands, e.g.
       "re-delete clip 3") saves memory but every operation needs a
       hand-written inverse - a classic source of student bugs. Snapshots
       are obviously correct, and n (clips) is small. Correctness wins.
"""
from __future__ import annotations
import copy


class History:
    def __init__(self, limit: int = 100) -> None:
        self._undo: list = []   # stack; top = end of list
        self._redo: list = []   # stack; top = end of list
        self._limit = limit     # cap memory: drop the oldest snapshot

    def record(self, state) -> None:
        """Call BEFORE applying an edit, with the pre-edit state."""
        self._undo.append(copy.deepcopy(state))
        if len(self._undo) > self._limit:
            self._undo.pop(0)        # O(n) but rare; limit is generous
        self._redo.clear()           # a new edit kills the redo "future"

    def undo(self, current):
        """Return the previous state, or None if there is nothing to undo."""
        if not self._undo:
            return None
        self._redo.append(copy.deepcopy(current))
        return self._undo.pop()

    def redo(self, current):
        """Return the next state, or None if there is nothing to redo."""
        if not self._redo:
            return None
        self._undo.append(copy.deepcopy(current))
        return self._redo.pop()

    @property
    def can_undo(self) -> bool: return bool(self._undo)
    @property
    def can_redo(self) -> bool: return bool(self._redo)
    @property
    def undo_depth(self) -> int: return len(self._undo)
    @property
    def redo_depth(self) -> int: return len(self._redo)
`;

const RENDER_PY = `"""Export jobs: a FIFO queue + the one replaceable encoding function.

DESIGN CHOICE - a QUEUE (collections.deque)
  Why: rendering is slow and CPU-heavy, so jobs must run one at a time,
       in the order they were submitted. Fairness = First-In-First-Out.
       deque.popleft() is O(1) (list.pop(0) would be O(n) shifting).
  Trade-off: no priorities - a huge job blocks later small ones. A
       heapq priority queue would fix that at the cost of starving big
       jobs and confusing users about order. For a local tool, FIFO.

REAL MEDIA WORK lives in encode_video() below and nowhere else.
Requirement for real renders: ffmpeg on PATH (see README). If ffmpeg or
the source files are unavailable it SIMULATES the encode so the whole
timeline/history/queue pipeline remains demoable - and it says so in
the returned message instead of silently pretending.
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass, field
import shutil, subprocess, time
from pathlib import Path


@dataclass
class RenderJob:
    job_id: int
    output_name: str                 # e.g. "final.mp4"
    clips: list = field(default_factory=list)  # list[Clip.to_dict()]
    status: str = "queued"           # queued -> rendering -> done | failed
    progress: int = 0                # 0..100
    message: str = ""


class RenderQueue:
    def __init__(self) -> None:
        self._q: deque[RenderJob] = deque()
        self._finished: list[RenderJob] = []
        self._next_id = 1

    def enqueue(self, output_name: str, clips: list) -> RenderJob:
        if not clips:
            raise ValueError("Nothing to export: the timeline is empty.")
        if not output_name.strip():
            raise ValueError("Output filename must not be empty.")
        job = RenderJob(self._next_id, output_name.strip(), list(clips))
        self._next_id += 1
        self._q.append(job)          # enqueue at the back - O(1)
        return job

    def process_next(self, uploads: Path, exports: Path) -> RenderJob | None:
        """Pop the FRONT job (FIFO) and run it. None if the queue is empty."""
        if not self._q:
            return None
        job = self._q.popleft()      # O(1) with deque
        job.status = "rendering"
        try:
            job.message = encode_video(job, uploads, exports)
            job.status, job.progress = "done", 100
        except Exception as exc:     # never let one bad job kill the queue
            job.status, job.message = "failed", f"Render failed: {exc}"
        self._finished.append(job)
        return job

    def pending(self) -> list[RenderJob]: return list(self._q)
    def finished(self) -> list[RenderJob]: return list(self._finished)


# ======================================================================
#  >>> THE REPLACEABLE ENCODING STEP <<<
#  Everything above is pure data-structure logic. Only this function
#  touches real media. Swap the body for moviepy if you prefer:
#      from moviepy.editor import VideoFileClip, concatenate_videoclips
#      parts = [VideoFileClip(str(uploads / c["source"]))
#               .subclip(c["trim_start"], c["trim_end"]) for c in job.clips]
#      concatenate_videoclips(parts).write_videofile(str(out))
# ======================================================================
def encode_video(job: RenderJob, uploads: Path, exports: Path) -> str:
    exports.mkdir(parents=True, exist_ok=True)
    out = exports / job.output_name
    missing = [c["source"] for c in job.clips if not (uploads / c["source"]).exists()]

    if shutil.which("ffmpeg") is None or missing:
        # ---- SIMULATION MODE (clearly reported, never silent) ----
        for pct in (25, 50, 75, 100):          # fake progress steps
            job.progress = pct
            time.sleep(0.05)
        out.write_text("SIMULATED EXPORT of: " +
                       ", ".join(c["name"] for c in job.clips))
        why = "ffmpeg not found on PATH" if shutil.which("ffmpeg") is None \\
              else f"missing source file(s): {', '.join(missing)}"
        return (f"Simulated encode ({why}). Install ffmpeg and place "
                f"sources in uploads/ for a real {job.output_name}.")

    # ---- REAL MODE: trim each clip, then concat with the demuxer ----
    parts, list_file = [], exports / "_concat.txt"
    for i, c in enumerate(job.clips):
        part = exports / f"_part{i}.mp4"
        cmd = ["ffmpeg", "-y", "-ss", str(c["trim_start"]), "-to", str(c["trim_end"]),
               "-i", str(uploads / c["source"]), "-c", "copy", str(part)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg trim failed for {c['source']}: "
                               + result.stderr.strip().splitlines()[-1])
        parts.append(part)
    list_file.write_text("\\n".join(f"file '{p.name}'" for p in parts))
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
           "-c", "copy", str(out)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    for p in parts + [list_file]:
        p.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError("ffmpeg concat failed: " + result.stderr.strip()[-300:])
    return f"Encoded {out.name} with ffmpeg ({len(job.clips)} clip(s) joined)."
`;

const APP_PY = `"""CutStudio - local Video Editor Tool (Flask).

Run:  python app.py     then open http://127.0.0.1:5000

Routes
  GET  /                homepage
  GET  /editor          editor UI (timeline list, preview, render queue)
  GET  /api/state       JSON: clips + history depths + queue (the UI polls this)
  POST /api/clips       add clip        {name, source, duration, index?}
  POST /api/clips/<i>/delete | /move {to} | /trim {start,end} | /join
  POST /api/undo  /api/redo
  POST /api/export      enqueue render  {output_name}
  POST /api/export/run  process the next queued job (FIFO)

Design notes
  * State is in-memory on purpose: this is a local, single-user teaching
    tool, so no database. Trade-off: restart the server, lose the edit.
    Swapping in sqlite later only touches this file + timeline.py.
  * Every mutating route follows the same pattern:
        validate -> history.record(snapshot) -> mutate -> return state
    and catches TimelineError/ValueError to return HTTP 400 + a friendly
    message. The browser never sees a stack trace.
"""
from __future__ import annotations
from pathlib import Path
from flask import Flask, jsonify, render_template, request

from editor.timeline import Clip, Timeline, TimelineError
from editor.history import History
from editor.render_queue import RenderQueue

BASE = Path(__file__).parent
UPLOADS, EXPORTS = BASE / "uploads", BASE / "exports"
UPLOADS.mkdir(exist_ok=True); EXPORTS.mkdir(exist_ok=True)

app = Flask(__name__)
timeline, history, queue = Timeline(), History(), RenderQueue()

# A starter sequence so the editor is alive on first load. The durations
# are metadata only - drop real files with these names into uploads/
# (plus ffmpeg) and exports become real video.
for name, src, dur in [("Cold open", "intro.mp4", 12),
                       ("Interview A", "interview.mp4", 48),
                       ("B-roll: skyline", "skyline.mp4", 18)]:
    timeline.append(Clip(name, src, dur))


def state():
    return jsonify(clips=[c.to_dict() for c in timeline.clips()],
                   total=timeline.total_duration(),
                   can_undo=history.can_undo, can_redo=history.can_redo,
                   undo_depth=history.undo_depth, redo_depth=history.redo_depth,
                   queue=[vars(j) | {"clips": len(j.clips)} for j in queue.pending()],
                   finished=[vars(j) | {"clips": len(j.clips)} for j in queue.finished()])


@app.errorhandler(TimelineError)
@app.errorhandler(ValueError)
def bad_input(err):                      # one friendly face for all bad input
    return jsonify(error=str(err)), 400


def body() -> dict:
    data = request.get_json(silent=True)
    if data is None:
        raise ValueError("Expected a JSON request body.")
    return data


@app.get("/")
def home():
    return render_template("index.html", n_clips=len(timeline),
                           total=timeline.total_duration())


@app.get("/editor")
def editor():
    return render_template("editor.html")


@app.get("/api/state")
def api_state():
    return state()


@app.post("/api/clips")
def add_clip():
    d = body()
    try:
        clip = Clip(name=str(d.get("name", "")).strip(),
                    source=str(d.get("source", "")).strip() or "clip.mp4",
                    duration=float(d.get("duration", 0)))
    except (TypeError, ValueError):
        raise ValueError("Duration must be a number of seconds, e.g. 12.5.")
    history.record(timeline.snapshot())
    idx = d.get("index")
    timeline.append(clip) if idx is None else timeline.insert(int(idx), clip)
    return state(), 201


@app.post("/api/clips/<int:i>/delete")
def delete_clip(i):
    history.record(timeline.snapshot())
    timeline.delete(i)                   # raises TimelineError if i is bad
    return state()


@app.post("/api/clips/<int:i>/move")
def move_clip(i):
    d = body()
    history.record(timeline.snapshot())
    timeline.move(i, int(d["to"]))
    return state()


@app.post("/api/clips/<int:i>/trim")
def trim_clip(i):
    d = body()
    history.record(timeline.snapshot())
    timeline.trim(i, float(d["start"]), float(d["end"]))
    return state()


@app.post("/api/clips/<int:i>/join")
def join_clip(i):
    history.record(timeline.snapshot())
    timeline.join(i)
    return state()


@app.post("/api/undo")
def undo():
    prev = history.undo(timeline.snapshot())
    if prev is None:
        raise ValueError("Nothing to undo.")
    timeline.restore(prev)
    return state()


@app.post("/api/redo")
def redo():
    nxt = history.redo(timeline.snapshot())
    if nxt is None:
        raise ValueError("Nothing to redo.")
    timeline.restore(nxt)
    return state()


@app.post("/api/export")
def export():
    d = body()
    queue.enqueue(str(d.get("output_name", "final.mp4")),
                  [c.to_dict() for c in timeline.clips()])
    return state(), 201


@app.post("/api/export/run")
def run_next():
    job = queue.process_next(UPLOADS, EXPORTS)
    if job is None:
        raise ValueError("The render queue is empty - enqueue an export first.")
    return state()


if __name__ == "__main__":
    print("CutStudio running at http://127.0.0.1:5000  (Ctrl+C to stop)")
    app.run(debug=True)
`;

const TEST_PY = `"""Tests for the core structures. Run:  python -m unittest discover -s tests -v
Covers exactly what was asked: insert, delete, move, undo, redo - plus
trim validation, join, and FIFO queue order."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from editor.timeline import Clip, Timeline, TimelineError, DoublyLinkedList
from editor.history import History
from editor.render_queue import RenderQueue


def names(t: Timeline):
    return [c.name for c in t.clips()]


class TestTimeline(unittest.TestCase):
    def setUp(self):
        self.t = Timeline()
        for n in "ABC":
            self.t.append(Clip(n, f"{n}.mp4", 10))

    def test_insert_at_index(self):
        self.t.insert(1, Clip("X", "x.mp4", 5))
        self.assertEqual(names(self.t), ["A", "X", "B", "C"])

    def test_insert_out_of_range_raises(self):
        with self.assertRaises(TimelineError):
            self.t.insert(99, Clip("X", "x.mp4", 5))

    def test_delete_returns_clip_and_shifts(self):
        removed = self.t.delete(1)
        self.assertEqual(removed.name, "B")
        self.assertEqual(names(self.t), ["A", "C"])

    def test_delete_from_empty_raises(self):
        with self.assertRaises(TimelineError):
            Timeline().delete(0)

    def test_move(self):
        self.t.move(0, 2)
        self.assertEqual(names(self.t), ["B", "C", "A"])
        self.t.move(2, 0)
        self.assertEqual(names(self.t), ["A", "B", "C"])

    def test_trim_ok_and_invalid_trim_rejected(self):
        self.t.trim(0, 2, 7)
        self.assertEqual(self.t.clips()[0].effective_duration, 5)
        with self.assertRaises(TimelineError):   # end beyond duration
            self.t.trim(0, 8, 20)
        with self.assertRaises(TimelineError):   # shorter than 0.5s
            self.t.trim(0, 1, 1.2)

    def test_join_adds_durations(self):
        self.t.join(0)
        self.assertEqual(names(self.t), ["A + B", "C"])
        self.assertEqual(self.t.clips()[0].effective_duration, 20)

    def test_total_duration_uses_trims(self):
        self.t.trim(1, 0, 3)
        self.assertEqual(self.t.total_duration(), 23)  # 10 + 3 + 10

    def test_linked_list_matches_array_order(self):
        dll = DoublyLinkedList()
        for n in "ABC":
            dll.append(Clip(n, f"{n}.mp4", 10))
        self.assertEqual([c.name for c in dll], ["A", "B", "C"])
        self.assertEqual(dll.get(1).name, "B")


class TestHistory(unittest.TestCase):
    def test_undo_then_redo(self):
        t, h = Timeline(), History()
        t.append(Clip("A", "a.mp4", 10))
        h.record(t.snapshot())                 # state before adding B
        t.append(Clip("B", "b.mp4", 10))
        t.restore(h.undo(t.snapshot()))        # undo -> only A
        self.assertEqual(names(t), ["A"])
        t.restore(h.redo(t.snapshot()))        # redo -> A, B again
        self.assertEqual(names(t), ["A", "B"])

    def test_new_edit_clears_redo(self):
        h = History()
        h.record([1]); h.undo([1, 2])
        self.assertTrue(h.can_redo)
        h.record([1])                          # a fresh edit...
        self.assertFalse(h.can_redo)           # ...kills the redo future

    def test_undo_with_empty_history_returns_none(self):
        self.assertIsNone(History().undo([]))


class TestRenderQueue(unittest.TestCase):
    def test_fifo_order(self):
        q = RenderQueue()
        clip = [Clip("A", "a.mp4", 10).to_dict()]
        q.enqueue("one.mp4", clip); q.enqueue("two.mp4", clip)
        self.assertEqual([j.output_name for j in q.pending()],
                         ["one.mp4", "two.mp4"])

    def test_empty_timeline_cannot_be_queued(self):
        with self.assertRaises(ValueError):
            RenderQueue().enqueue("x.mp4", [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CutStudio - local Video Editor</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <header><strong>CutStudio</strong> <span>local video editor - Python + Flask</span></header>
  <main>
    <h1>Edit video. Locally. With data structures you can read.</h1>
    <p>An array-backed timeline, stack-based undo/redo and a FIFO render
       queue - about 600 lines of commented Python.</p>
    <p>Your current sequence has <strong>{{ n_clips }} clip(s)</strong>
       totalling <strong>{{ total }}s</strong>.</p>
    <p><a class="btn" href="/editor">Open the editor &rarr;</a></p>
    <h2>Quick start</h2>
    <ol>
      <li>Drop source files into <code>uploads/</code> (optional - metadata-only works).</li>
      <li>Add clips, drag the order with Move, Trim, Join.</li>
      <li>Undo freely (it is a stack - go on, try to break it).</li>
      <li>Export: jobs join a FIFO queue; ffmpeg does the real encode when available.</li>
    </ol>
  </main>
</body>
</html>
`;

const EDITOR_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Editor - CutStudio</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <header><strong>CutStudio</strong> <a href="/">Home</a></header>
  <main>
    <h1>Editor</h1>
    <p id="msg" role="alert"></p>

    <section id="preview"><h2>Preview (sequence)</h2><div id="strip"></div>
      <p id="total"></p></section>

    <section><h2>Timeline (array-backed list)</h2>
      <ol id="clips"></ol>
      <form id="add">
        <input name="name" placeholder="Clip name" required>
        <input name="source" placeholder="intro.mp4">
        <input name="duration" type="number" step="0.1" min="0.5" placeholder="seconds" required>
        <button>Add clip</button>
      </form>
      <p>
        <button onclick="post('/api/undo')">Undo</button>
        <button onclick="post('/api/redo')">Redo</button>
        <span id="depths"></span>
      </p>
    </section>

    <section><h2>Render queue (FIFO)</h2>
      <ul id="queue"></ul>
      <form id="export">
        <input name="output_name" value="final.mp4">
        <button>Enqueue export</button>
        <button type="button" onclick="post('/api/export/run')">Process next job</button>
      </form>
      <ul id="finished"></ul>
    </section>
  </main>

<script>
// Tiny vanilla-JS front end: every action POSTs to the JSON API and
// re-renders from the returned state. No build step, nothing to install.
async function post(url, data) {
  const r = await fetch(url, {method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data || {})});
  const s = await r.json();
  document.getElementById("msg").textContent = r.ok ? "" : ("Error: " + s.error);
  if (r.ok) render(s);
}
function render(s) {
  document.getElementById("total").textContent =
    "Total: " + s.total + "s across " + s.clips.length + " clip(s)";
  document.getElementById("depths").textContent =
    "undo stack: " + s.undo_depth + " - redo stack: " + s.redo_depth;
  document.getElementById("strip").innerHTML = s.clips.map(c =>
    '<span class="block" style="flex:' + c.effective_duration + '">' +
    c.name + " (" + c.effective_duration + 's)</span>').join("");
  document.getElementById("clips").innerHTML = s.clips.map((c, i) =>
    "<li><strong>" + c.name + "</strong> " + c.source +
    " - trim " + c.trim_start + ".." + c.trim_end + " of " + c.duration + "s " +
    '<button onclick="post(\\'/api/clips/' + i + '/move\\',{to:' + (i-1) + '})">up</button>' +
    '<button onclick="post(\\'/api/clips/' + i + '/move\\',{to:' + (i+1) + '})">down</button>' +
    '<button onclick="trim(' + i + ')">trim</button>' +
    '<button onclick="post(\\'/api/clips/' + i + '/join\\')">join next</button>' +
    '<button onclick="post(\\'/api/clips/' + i + '/delete\\')">delete</button></li>').join("");
  document.getElementById("queue").innerHTML =
    s.queue.map(j => "<li>#" + j.job_id + " " + j.output_name + " - queued</li>").join("");
  document.getElementById("finished").innerHTML =
    s.finished.map(j => "<li>#" + j.job_id + " " + j.output_name + " - " +
      j.status + " - " + j.message + "</li>").join("");
}
function trim(i) {
  const start = parseFloat(prompt("Trim start (seconds)"));
  const end = parseFloat(prompt("Trim end (seconds)"));
  if (!isNaN(start) && !isNaN(end))
    post("/api/clips/" + i + "/trim", {start, end});
}
document.getElementById("add").onsubmit = e => {
  e.preventDefault();
  post("/api/clips", Object.fromEntries(new FormData(e.target)));
};
document.getElementById("export").onsubmit = e => {
  e.preventDefault();
  post("/api/export", Object.fromEntries(new FormData(e.target)));
};
fetch("/api/state").then(r => r.json()).then(render);
</script>
</body>
</html>
`;

const STYLE_CSS = `body { font-family: system-ui, sans-serif; margin: 0; background: #0f1117; color: #e8eaf0; }
header { padding: 14px 24px; background: #171a24; display: flex; gap: 16px; align-items: baseline; }
header span, a { color: #9aa3b8; }
main { max-width: 960px; margin: 0 auto; padding: 24px; }
section { background: #171a24; border-radius: 12px; padding: 16px 20px; margin: 16px 0; }
.btn { background: #635bff; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; }
#strip { display: flex; gap: 4px; min-height: 56px; }
.block { background: #635bff; border-radius: 8px; padding: 10px; font-size: 13px; overflow: hidden; }
input, button { padding: 8px 10px; border-radius: 8px; border: 1px solid #333a4d; background: #0f1117; color: inherit; }
button { cursor: pointer; background: #232839; }
#msg { color: #ff8a8a; min-height: 20px; }
`;

const INIT_PY = `"""CutStudio editor package: timeline (list), history (stacks), queue (deque)."""
`;

export const FOLDER_TREE = `cutstudio/
|-- app.py                  Flask routes + JSON API + error handling
|-- requirements.txt        Flask only - no heavy dependencies
|-- README.md               install & run instructions
|-- editor/
|   |-- __init__.py
|   |-- timeline.py         Clip + Timeline (array-backed list) + DoublyLinkedList
|   |-- history.py          Undo/redo - two stacks (LIFO)
|   +-- render_queue.py     FIFO render queue + encode_video() ffmpeg stub
|-- templates/
|   |-- index.html          homepage
|   +-- editor.html         editor UI (timeline, preview, queue)
|-- static/
|   +-- style.css
|-- uploads/                <- put your source video files here
|-- exports/                <- finished renders are written here
+-- tests/
    +-- test_timeline.py    unittest: insert / delete / move / undo / redo / ...`;

export const PYTHON_FILES: SourceFile[] = [
  { path: "README.md", lang: "text", purpose: "Install, ffmpeg requirement, run & test instructions", content: README },
  { path: "requirements.txt", lang: "text", purpose: "Only Flask - no heavy dependencies", content: REQUIREMENTS },
  { path: "app.py", lang: "python", purpose: "Flask app: homepage, editor, JSON API, friendly error handling", content: APP_PY },
  { path: "editor/__init__.py", lang: "python", purpose: "Package marker", content: INIT_PY },
  { path: "editor/timeline.py", lang: "python", purpose: "Array-backed Timeline + DoublyLinkedList comparison, trim validation", content: TIMELINE_PY },
  { path: "editor/history.py", lang: "python", purpose: "Undo/redo with two stacks (snapshot approach)", content: HISTORY_PY },
  { path: "editor/render_queue.py", lang: "python", purpose: "FIFO queue (deque) + replaceable encode_video() ffmpeg/subprocess stub", content: RENDER_PY },
  { path: "templates/index.html", lang: "html", purpose: "Homepage template", content: INDEX_HTML },
  { path: "templates/editor.html", lang: "html", purpose: "Editor interface: clip list, trim/move/join, preview strip, queue", content: EDITOR_HTML },
  { path: "static/style.css", lang: "css", purpose: "Dark studio styling for both templates", content: STYLE_CSS },
  { path: "tests/test_timeline.py", lang: "python", purpose: "unittest: insert, delete, move, undo, redo, trim, join, FIFO", content: TEST_PY },
];
