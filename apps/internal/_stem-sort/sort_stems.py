#!/usr/bin/env python3
"""
sort_stems.py — classify a folder of song stems into instrument categories.

Two signals per file:
  1. NAME  — keyword rules on the Ableton track name ("Main-Snare", "SERUM-BASS", "Vox"...)
  2. AUDIO — EfficientAT mn10 (AudioSet, 527 classes) run on up to 8 ten-second windows
             taken from the active parts of the stem, plus simple spectral features
             (low-end ratio, sustain, loudness).

The two are combined into one category + confidence, with flags for anything worth a
listen. Nothing is moved or modified: results go to a CSV/JSON report, and `--link`
builds a browsable by-category view made of symlinks (zero extra disk space).

Usage:
  python sort_stems.py analyze  ROOT [--out DIR] [--budget SECONDS]   # resumable
  python sort_stems.py report   ROOT [--out DIR]                       # CSV + summary
  python sort_stems.py link     ROOT [--out DIR]                       # symlink view
"""
import argparse, csv, json, math, os, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
CATEGORIES = ["drums", "bass", "vocals", "keys", "synths", "orchestral", "guitar",
              "fx", "mixes", "returns", "silent"]

# ----------------------------------------------------------------------------- names

def track_name(path: Path) -> str:
    """'Trouble-7-9-25 17-Kenny's Favorite Kick (Dubai Shit).wav' -> 'Kenny's Favorite Kick (Dubai Shit)'"""
    stem = path.stem
    i = stem.find(" ")
    if i < 0:
        return ""                       # bare export = the song's full bounce
    name = stem[i + 1:]
    name = re.sub(r"\s?\[\d{4}-\d{2}-\d{2} \d+\]", "", name)          # [2025-10-28 194239]
    name = re.sub(r"\s?\((Bounce|Freeze tail|Freeze)\)", "", name)
    name = re.sub(r"^(\d+(-|\. ))+", "", name)                         # 17- / 9-9- / 19.
    name = re.sub(r"^Freeze ", "", name)
    return name.strip()

# (category, strength, regex). First strong match wins; weak = a plugin name / vague hint.
W = r"(?<![a-z])"   # word-ish boundary that treats _ - digits as separators
RULES = [
    ("returns", "strong", r"^[a-f]-(reverb|delay|valhalla|return|ping|reaktor|room|verb)"),
    ("fx",      "strong", W + r"(fx|sfx|riser|impact|woosh|whoosh|sweep|foley|noise|downlifter|uplifter|crowd|ocean|waves|dinosaur|gunshot|clock|bell|metallic|shimmer|reverb_tail|tail_rev)"),
    ("drums",   "strong", W + r"(kick|snare|snr|clap|claps|hat|hats|hh|hihat|hi hat|open hat|cymbal|crash|ride|tom|rim|rimshot|perc|percs|percussion|drum|drums|break|breakbeat|breaks|fill|taiko|tamb|tambourine|shaker|stomp|stomps|snap|groove|kit_loop|transient)"),
    ("bass",    "strong", W + r"(808|bass|bassline|sub|reese)"),
    ("vocals",  "strong", W + r"(vox|vocal|vocals|vocal_|acapella|accapella|a capella|acappella|choir|chant|adlib|bgv|rap|sing|singing|voice|voicetext|preacherman|lyric)"),
    ("keys",    "strong", W + r"(piano|keys|rhodes|organ|epiano|wurli)"),
    ("orchestral", "strong", W + r"(strings|string|violin|viola|cello|orchestra|orch|horns|horn|brass|flute|harp|cellos)"),
    ("guitar",  "strong", W + r"(guitar|gtr|acoustic)"),
    ("synths",  "strong", W + r"(synth|synths|sytnh|lead|leads|pluck|saw|saws|arp|pad|pads|stab|stabby|square|screech|squiggl|squiggly|lfo)"),
    ("synths",  "weak",   W + r"(serum|massive|wavetable|operator|reaktor|iris|granulator|mel|melo|melody|melodic|chords)"),
    ("mixes",   "weak",   r"(mixdown|master|mix\d|_mix|mastered|full)"),
    ("drums",   "weak",   r"drum rack"),
]
RULES = [(c, s, re.compile(rx + (r"s?(?![a-z])" if rx.startswith(W) else ""), re.I)) for c, s, rx in RULES]
# Ableton default / container names that say nothing about the sound.
GENERIC = re.compile(r"^(audio( \w+)?|group|kontakt( \d)?|midi( \d)?|instrument rack|sample\d?|samples|"
                     r"resample|loop|\d+|[a-z]|track.*|default_\d+|normal|one shot|bounce.*|)$", re.I)


def name_hint(path: Path):
    name = track_name(path)
    if name == "":
        return "mixes", "strong", "(full song bounce)"
    if GENERIC.match(name.strip()):
        return None, None, name
    weak = None
    for cat, strength, rx in RULES:
        if rx.search(name):
            if strength == "strong":
                return cat, "strong", name
            weak = weak or (cat, "weak", name)
    if weak:
        return weak[0], weak[1], name
    return None, None, name

# ----------------------------------------------------------------------------- audio

GROUPS = {
    "drums": ["Drum kit", "Drum machine", "Drum", "Snare drum", "Rimshot", "Drum roll", "Bass drum",
              "Cymbal", "Hi-hat", "Percussion", "Tambourine", "Wood block", "Clapping", "Tabla",
              "Timpani", "Beatboxing", "Maraca", "Rattle (instrument)"],
    "vocals": ["Speech", "Male speech, man speaking", "Female speech, woman speaking",
               "Child speech, kid speaking", "Conversation", "Narration, monologue", "Singing", "Choir",
               "Chant", "Male singing", "Female singing", "Child singing", "Synthetic singing", "Rapping",
               "Humming", "A capella", "Shout", "Yell", "Whispering", "Laughter", "Yodeling", "Mantra"],
    "bass": ["Bass guitar", "Double bass"],
    "keys": ["Piano", "Electric piano", "Keyboard (musical)", "Organ", "Electronic organ",
             "Hammond organ", "Harpsichord"],
    "synths": ["Synthesizer", "Sampler", "Theremin"],
    "orchestral": ["Orchestra", "Brass instrument", "French horn", "Trumpet", "Trombone",
                   "Bowed string instrument", "String section", "Violin, fiddle", "Pizzicato", "Cello",
                   "Wind instrument, woodwind instrument", "Flute", "Saxophone", "Clarinet", "Harp"],
    "guitar": ["Guitar", "Electric guitar", "Acoustic guitar", "Plucked string instrument", "Strum",
               "Steel guitar, slide guitar"],
}
MUSIC_LABELS = ["Music", "Musical instrument"]

SR_MODEL = 32000
WIN_S = 10.0
MAX_WINDOWS = 8
SILENT_DB = -60.0


class Tagger:
    def __init__(self):
        import torch
        sys.path.insert(0, str(HERE / "EfficientAT"))
        cwd = os.getcwd(); os.chdir(HERE / "EfficientAT")   # model looks for weights in ./resources
        try:
            import contextlib, io
            from models.mn.model import get_model
            from models.preprocess import AugmentMelSTFT
            from helpers.utils import labels
            with contextlib.redirect_stdout(io.StringIO()):
                self.model = get_model(width_mult=1.0, pretrained_name="mn10_as")
        finally:
            os.chdir(cwd)
        self.torch = torch
        self.model.eval()
        self.mel = AugmentMelSTFT(n_mels=128, sr=SR_MODEL, win_length=800, hopsize=320).eval()
        self.labels = list(labels)
        idx = {l: i for i, l in enumerate(self.labels)}
        self.group_idx = {g: [idx[l] for l in ls if l in idx] for g, ls in GROUPS.items()}
        missing = [l for ls in GROUPS.values() for l in ls if l not in idx]
        if missing:
            print("warning: unknown AudioSet labels:", missing, file=sys.stderr)
        self.music_idx = [idx[l] for l in MUSIC_LABELS]

    def __call__(self, windows):
        torch = self.torch
        x = torch.from_numpy(np.stack(windows)).float()
        with torch.no_grad():
            spec = self.mel(x)
            logits, _ = self.model(spec.unsqueeze(1))
        return torch.sigmoid(logits).numpy()            # (n_windows, 527)


def load_windows(path: Path):
    """Stream the file once: loudness profile, pick active windows, spectral features."""
    import torch, torchaudio.functional as AF
    info = sf.info(str(path))
    sr = info.samplerate
    hop = int(sr * 0.05)                                 # 50 ms RMS frames
    rms = []
    peak = 0.0
    with sf.SoundFile(str(path)) as f:
        for block in f.blocks(blocksize=hop * 200, dtype="float32", always_2d=True):
            mono = block.mean(axis=1)
            peak = max(peak, float(np.abs(block).max(initial=0)))
            n = len(mono) // hop
            if n:
                fr = mono[: n * hop].reshape(n, hop)
                rms.append(np.sqrt((fr ** 2).mean(axis=1) + 1e-12))
    rms = np.concatenate(rms) if rms else np.zeros(1)
    peak_db = 20 * math.log10(peak + 1e-12)
    db = 20 * np.log10(rms + 1e-12)
    feats = {"duration": round(info.duration, 1), "peak_db": round(peak_db, 1)}
    if peak_db < SILENT_DB:
        return None, feats

    active = db > max(db.max() - 30, -55)
    if not active.any():                                # audible peak but only clicks / noise floor
        feats["near_silent"] = True
        return None, feats
    feats["active_frac"] = round(float(active.mean()), 3)
    # sustain: of the active frames, how many stay within 12 dB of the loud level (kicks/one-shots low, pads/808s high)
    loud = np.percentile(db[active], 95)
    feats["sustain"] = round(float((db[active] > loud - 12).mean()), 3)

    # choose window starts spread across active regions
    fps = 20
    win_fr = int(WIN_S * fps)
    act_idx = np.flatnonzero(active)
    if len(db) <= win_fr:
        starts = [0]
        cover = None
    else:
        # score each possible start by active coverage, take best per segment of the timeline
        cs = np.concatenate([[0], np.cumsum(active)])
        cover = cs[win_fr:] - cs[:-win_fr]
        segs = np.array_split(np.arange(len(cover)), MAX_WINDOWS)
        cands = [int(seg[np.argmax(cover[seg])]) for seg in segs if len(seg)]
        good = [c for c in cands if cover[c] >= 0.5 * win_fr]
        if good:
            starts = good
        else:
            # sparse stem: take the densest non-overlapping windows instead of spreading out
            order = np.argsort(cover)[::-1]
            starts = []
            for c in order:
                if cover[c] <= 0:
                    break
                if all(abs(int(c) - s0) >= win_fr for s0 in starts):
                    starts.append(int(c))
                if len(starts) >= 3:
                    break
            starts = starts or [int(max(0, act_idx[0] - 5))]
    windows, spec_acc, weights = [], None, []
    with sf.SoundFile(str(path)) as f:
        for st in starts:
            f.seek(st * hop)
            seg = f.read(int(WIN_S * sr), dtype="float32", always_2d=True).mean(axis=1)
            if len(seg) < int(WIN_S * sr):
                seg = np.pad(seg, (0, int(WIN_S * sr) - len(seg)))
            # spectrum for low-end ratio
            S = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
            spec_acc = S if spec_acc is None else spec_acc + S
            w = AF.resample(torch.from_numpy(seg), sr, SR_MODEL).numpy()
            # normalize quiet stems so the model hears them at a sensible level
            m = np.abs(w).max()
            if m > 0:
                w = w * min(0.5 / m, 100.0)
            windows.append(w)
            weights.append(float(active[st:st + win_fr].mean()) if len(active[st:st + win_fr]) else 1.0)
    freqs = np.fft.rfftfreq(int(WIN_S * sr), 1 / sr)
    tot = spec_acc.sum() + 1e-12
    feats["low_ratio"] = round(float(spec_acc[freqs < 150].sum() / tot), 3)
    feats["high_ratio"] = round(float(spec_acc[freqs > 5000].sum() / tot), 3)
    centroid = float((freqs * spec_acc).sum() / tot)
    feats["centroid_hz"] = int(centroid)
    feats["weights"] = [round(w, 3) for w in weights]
    return windows, feats


def analyze_file(tagger, path: Path):
    windows, feats = load_windows(path)
    rec = {"features": feats}
    if windows is None:
        return rec
    probs = tagger(windows)
    wts = np.array(feats.pop("weights")) + 1e-3
    mean = (probs * wts[:, None]).sum(axis=0) / wts.sum()
    mx = probs.max(axis=0)
    rec["groups"] = {g: round(float(mean[ix].max()), 4) for g, ix in tagger.group_idx.items()}
    rec["groups_max"] = {g: round(float(mx[ix].max()), 4) for g, ix in tagger.group_idx.items()}
    rec["music"] = round(float(mean[tagger.music_idx].max()), 4)
    top = np.argsort(mean)[::-1][:6]
    rec["top_tags"] = [[tagger.labels[i], round(float(mean[i]), 3)] for i in top]
    rec["n_windows"] = len(windows)
    rec["probs"] = [round(float(v), 4) for v in mean]
    return rec

# ----------------------------------------------------------------------------- decide

TRAIN_CLASSES = ["drums", "bass", "vocals", "synths", "fx", "mixes"]
CONFUSABLE = {frozenset(p) for p in [("bass", "synths"), ("drums", "fx"), ("synths", "fx"), ("vocals", "fx"),
                                      ("bass", "drums"), ("mixes", "drums"), ("mixes", "vocals"), ("mixes", "synths")]}


def feature_vec(rec):
    f = rec["features"]
    return np.concatenate([np.log(np.array(rec["probs"]) + 1e-4),
                           [rec["music"], f["low_ratio"], f["sustain"], f["high_ratio"],
                            math.log(f["centroid_hz"] + 1) / 10]])


class AudioClassifier:
    """Logistic regression trained on THIS library's clearly-named stems, applied to the rest."""

    def __init__(self, recs, root):
        from sklearn.linear_model import LogisticRegression
        X, y = [], []
        for r in recs:
            if "probs" not in r:
                continue
            hint, strength, _ = name_hint(root / r["file"])
            if strength == "strong" and hint in TRAIN_CLASSES:
                X.append(feature_vec(r)); y.append(hint)
        X = np.array(X)
        self.mu, self.sd = X.mean(0), X.std(0) + 1e-6
        self.m = LogisticRegression(C=0.003, max_iter=5000, class_weight="balanced")
        self.m.fit((X - self.mu) / self.sd, y)
        self.classes = list(self.m.classes_)
        self.n_train = len(y)

    def proba(self, rec):
        p = self.m.predict_proba(((feature_vec(rec) - self.mu) / self.sd)[None])[0]
        return dict(zip(self.classes, p))


def refine(cat, rec):
    """Too few named keys/orchestral/guitar stems to learn them — use the tagger's own scores."""
    g = rec["groups"]
    if cat in ("synths", "fx", "vocals", "drums"):
        best = max(("keys", "orchestral", "guitar"), key=lambda k: g[k])
        if g[best] >= 0.08 and g[best] > 1.5 * g["synths"] and g[best] > g["vocals"] and g[best] > g["drums"]:
            return best
    return cat


def decide(path: Path, rec, clf):
    hint, strength, name = name_hint(path)
    f = rec.get("features", {})
    flags = []
    if "probs" not in rec:
        if f.get("near_silent") or f.get("peak_db", -999) > -200:
            flags.append(f"very quiet but not empty (peak {f.get('peak_db')} dB)")
        return {"category": "silent", "confidence": 0.99, "source": "audio", "name_hint": hint or "",
                "audio_guess": "silent", "audio_prob": 1.0, "flags": "; ".join(flags), "track_name": name}
    p = clf.proba(rec)
    a_cat = max(p, key=p.get)
    a_p = p[a_cat]
    a_ref = refine(a_cat, rec)
    if strength == "strong":
        cat = hint
        agree = a_ref == hint or p.get(hint, 0) >= 0.25
        conf, src = (0.97, "name+audio") if agree else (0.85, "name")
        if hint == "returns":
            conf, src = 0.9, "name"
        elif not agree and a_p > 0.7 and frozenset((hint, a_ref)) not in CONFUSABLE:
            flags.append(f"name says {hint}, audio says {a_ref} ({a_p:.0%})")
    else:
        cat, conf, src = a_ref, a_p, "audio"
        if strength == "weak" and hint != cat and p.get(hint, 0) >= 0.3:
            cat, conf, src = hint, max(p[hint], 0.5), "audio+name"
        elif strength == "weak" and hint == cat:
            conf, src = min(0.97, conf + 0.15), "audio+name"
        if conf < 0.4:
            runner = sorted(p, key=p.get, reverse=True)[1]
            flags.append(f"low confidence (maybe {runner})")
    if re.match(r"^group\b", name, re.I):
        flags.append("group/bus track")
    return {"category": str(cat), "confidence": round(float(conf), 2), "source": src, "name_hint": hint or "",
            "audio_guess": str(a_ref), "audio_prob": round(float(a_p), 2), "flags": "; ".join(flags),
            "track_name": name}

# ----------------------------------------------------------------------------- commands

def wavs(root: Path, out: Path):
    return sorted(p for p in root.rglob("*.wav") if out not in p.parents)


def cmd_analyze(root, out, budget):
    cache_p = out / "analysis.jsonl"
    done = set()
    if cache_p.exists():
        for line in cache_p.open():
            try: done.add(json.loads(line)["file"])
            except Exception: pass
    todo = [p for p in wavs(root, out) if str(p.relative_to(root)) not in done]
    print(f"{len(done)} done, {len(todo)} to go", flush=True)
    if not todo:
        return 0
    tagger = Tagger()
    t0 = time.time(); n = 0
    with cache_p.open("a") as fh:
        for p in todo:
            if time.time() - t0 > budget:
                break
            rel = str(p.relative_to(root))
            try:
                rec = analyze_file(tagger, p)
            except Exception as e:
                rec = {"error": repr(e)[:200], "features": {}}
            rec["file"] = rel
            fh.write(json.dumps(rec) + "\n"); fh.flush()
            n += 1
    left = len(todo) - n
    print(f"analyzed {n} in {time.time()-t0:.0f}s, {left} left", flush=True)
    return left


def load_results(root, out):
    recs = {}
    for line in (out / "analysis.jsonl").open():
        r = json.loads(line)
        if (root / r["file"]).exists():          # skip stems deleted since analysis
            recs[r["file"]] = r
    clf = AudioClassifier(recs.values(), root)
    print(f"audio classifier trained on {clf.n_train} clearly-named stems", file=sys.stderr)
    rows = []
    for rel, r in sorted(recs.items()):
        p = root / rel
        d = decide(p, r, clf)
        f = r.get("features", {})
        rows.append({"song": Path(rel).parts[0], "file": Path(rel).name, **d,
                     "top_tags": ", ".join(f"{t} {s:.2f}" for t, s in r.get("top_tags", [])[:4]),
                     "duration_s": f.get("duration", ""), "peak_db": f.get("peak_db", ""),
                     "active_pct": round(100 * f["active_frac"]) if "active_frac" in f else "",
                     "low_ratio": f.get("low_ratio", ""), "sustain": f.get("sustain", ""),
                     "error": r.get("error", ""), "path": rel})
    return rows


def cmd_report(root, out):
    rows = load_results(root, out)
    cols = list(rows[0].keys())
    with (out / "stems_report.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(rows)
    manifest = defaultdict(lambda: defaultdict(list))
    for r in rows:
        manifest[r["song"]][r["category"]].append(r["file"])
    (out / "stems_by_category.json").write_text(json.dumps(manifest, indent=2))
    c = Counter(r["category"] for r in rows)
    flagged = [r for r in rows if r["flags"]]
    lines = [f"# Stem sort — {len(rows)} files, {len(manifest)} songs", ""]
    lines += [f"- **{k}**: {c.get(k, 0)}" for k in CATEGORIES]
    lines += ["", f"Flagged for a listen: {len(flagged)}", ""]
    lines += ["| song | file | category | conf | flag |", "|---|---|---|---|---|"]
    for r in sorted(flagged, key=lambda r: (r["song"], r["file"])):
        lines.append(f"| {r['song']} | {r['track_name'] or r['file']} | {r['category']} | {r['confidence']} | {r['flags']} |")
    (out / "SUMMARY.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:16]))


def cmd_link(root, out):
    rows = load_results(root, out)
    view = out / "by-category"
    for r in rows:
        d = view / r["category"] / r["song"]
        d.mkdir(parents=True, exist_ok=True)
        dst = d / r["file"]
        target = os.path.relpath(root / r["path"], d)
        if dst.is_symlink() or dst.exists():
            dst.unlink()
        dst.symlink_to(target)
    print(f"linked {len(rows)} files under {view}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["analyze", "report", "link"])
    ap.add_argument("root", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--budget", type=float, default=1e9, help="stop analyzing after N seconds (resume later)")
    a = ap.parse_args()
    root = a.root.resolve()
    out = (a.out or root / "_stem-sort").resolve()
    out.mkdir(parents=True, exist_ok=True)
    if a.cmd == "analyze":
        cmd_analyze(root, out, a.budget)
    elif a.cmd == "report":
        cmd_report(root, out)
    else:
        cmd_link(root, out)
