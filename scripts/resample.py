#!/usr/bin/env python3
"""Local plugin-chain capture, loop auditioning, and isolated offline rendering.

Run with the Python environment from scripts/requirements-resample.txt.
No catalog records, source audio, or installed plugin presets are modified.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys
import tempfile
import threading
import uuid

DEFAULT_WORKSPACE = Path(__file__).resolve().parents[1] / 'apps/internal/media/resampling'
AUDIO_EXTS = {'.wav', '.aif', '.aiff', '.flac', '.mp3', '.ogg', '.m4a', '.aac'}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def atomic_bytes(path, data, overwrite=True):
    """Publish a complete file; exclusive publication also protects against races."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.resample-', suffix=path.suffix, dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        publish(temporary, path, overwrite)
    finally:
        temporary.unlink(missing_ok=True)


def publish(temporary, destination, overwrite):
    if overwrite:
        os.replace(temporary, destination)
    else:
        os.link(temporary, destination)  # fails if someone else created it
        temporary.unlink()


def write_json(path, value):
    atomic_bytes(path, (json.dumps(value, indent=2, allow_nan=False) + '\n').encode())


def read_registry(root):
    path = root / 'chains.json'
    if not path.exists():
        return {'version': 1, 'chains': {}}
    value = json.loads(path.read_text())
    if value.get('version') != 1 or not isinstance(value.get('chains'), dict):
        raise ValueError(f'Unsupported chain registry: {path}')
    return value


@contextmanager
def registry_lock(root):
    import fcntl
    root.mkdir(parents=True, exist_ok=True)
    with (root / '.chains.lock').open('a') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another capture/edit session is using this workspace.') from None
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def state_file(root, entry):
    path = (root / entry['state']).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Preset state must remain inside the workspace.')
    data = path.read_bytes()  # missing state is fatal; never render defaults instead
    if not data:
        raise ValueError(f'Empty plugin state: {path}')
    if digest(data) != entry['state_sha256']:
        raise ValueError(f'Preset state hash mismatch: {path}')
    return path


def load_entry(root, entry, sample_rate=44100):
    from pedalboard import load_plugin
    data = state_file(root, entry).read_bytes()
    current = plugin_entry(entry['plugin'])
    if current['plugin_version'] != entry.get('plugin_version'):
        raise ValueError(f'Plugin version changed for {entry["plugin"]}; capture a new chain revision.')
    plugin = load_plugin(entry['plugin'], plugin_name=entry.get('plugin_name'))
    prepare_plugin(plugin, sample_rate)
    plugin.raw_state = data
    return plugin


def prepare_plugin(plugin, sample_rate=44100):
    import numpy as np
    if not plugin.is_effect:
        raise ValueError(f'{plugin.name} is not an audio effect.')
    # Some AUs (including Decapitator) expose neither parameters nor state until
    # first prepared for playback. Prepare BEFORE restoring any saved state.
    plugin(np.zeros((2, 2048), dtype=np.float32), sample_rate, reset=True)


def plugin_entry(spec):
    path, _, name = spec.partition('::')
    path = Path(path).expanduser().resolve(strict=True)
    if path.suffix.lower() not in {'.vst3', '.component'}:
        raise ValueError(f'Expected a VST3 or Audio Unit bundle: {path}')
    version = None
    info = path / 'Contents/Info.plist'
    if info.exists():
        with info.open('rb') as f:
            version = plistlib.load(f).get('CFBundleShortVersionString')
    return {'plugin': str(path), 'plugin_name': name or None, 'plugin_version': version}


def save_chain(root, registry, name, entries, plugins):
    """Write a new revision completely before switching the registry pointer."""
    revision = uuid.uuid4().hex
    saved = []
    for i, (entry, plugin) in enumerate(zip(entries, plugins)):
        data = plugin.raw_state
        if not data:
            raise ValueError(f'{plugin.name} returned empty state; previous chain was not replaced.')
        relative = Path('presets') / revision / f'{i:02d}.bin'
        atomic_bytes(root / relative, data, overwrite=False)
        saved.append({**entry, 'label': plugin.name, 'state': str(relative),
                      'state_sha256': digest(data)})
    previous = registry['chains'].get(name, {})
    timestamp = now()
    chain = {'revision': revision, 'created_at': previous.get('created_at', timestamp),
             'updated_at': timestamp, 'plugins': saved}
    registry['chains'][name] = chain
    write_json(root / 'chains.json', registry)
    return chain


def get_chain(root, name):
    registry = read_registry(root)
    if name not in registry['chains']:
        raise ValueError(f'Unknown chain: {name}')
    return registry['chains'][name]


def channels(audio, policy):
    import numpy as np
    if audio.ndim != 2 or audio.shape[0] not in (1, 2) or not audio.shape[1]:
        raise ValueError('Expected nonempty mono or stereo audio.')
    if not np.isfinite(audio).all():
        raise ValueError('Audio contains NaN or infinity.')
    if audio.shape[0] == 1 and policy == 'stereo':
        return np.repeat(audio, 2, axis=0)
    return audio


def read_audio(path, start=0, duration=None):
    from pedalboard.io import AudioFile
    import numpy as np
    with AudioFile(str(path)) as f:
        sr = f.samplerate
        f.seek(int(start * sr))
        if duration is not None:
            audio = f.read(int(duration * sr))
        else:
            parts = []
            while True:
                part = f.read(65536)
                if not part.shape[1]:
                    break
                parts.append(part)
            audio = np.concatenate(parts, axis=1) if parts else np.empty((f.num_channels, 0))
    return audio, sr


class LoopPlayer:
    """Editors stay on the main thread; processing/output run on a worker thread."""
    def __init__(self, board, audio, sr, device, monitor_db):
        self.board, self.audio, self.sr = board, audio, sr
        self.device, self.gain = device, 10 ** (monitor_db / 20)
        self.stop = threading.Event()
        self.failed = threading.Event()
        self.ready = threading.Event()
        self.error = None

    def __enter__(self):
        import numpy as np
        # Plugins were prepared before state restoration. Decapitator AU loses
        # restored parameters on reset=True, so never reset a configured instance.
        self.board(np.zeros((self.audio.shape[0], 2048), dtype=np.float32), self.sr, reset=False)
        self.thread = threading.Thread(target=self.run, name='resample-audition', daemon=True)
        self.thread.start()
        if not self.ready.wait(15):
            self.stop.set()
            raise RuntimeError('Audio output did not start within 15 seconds.')
        self.check()
        return self

    def run(self):
        import numpy as np
        from pedalboard.io import AudioStream
        try:
            device = AudioStream.default_output_device_name if self.device == 'default' else self.device
            if not device:
                raise ValueError('No default audio output device is available; run devices or use --device.')
            with AudioStream(output_device_name=device, sample_rate=self.sr,
                             num_output_channels=2, buffer_size=512) as stream:
                self.ready.set()
                position = 0
                while not self.stop.is_set():
                    end = min(position + 2048, self.audio.shape[1])
                    out = self.board(self.audio[:, position:end], self.sr, reset=False)
                    if not np.isfinite(out).all():
                        raise ValueError('Plugin produced non-finite audition audio.')
                    if out.shape[1]:
                        # Monitor-only hard ceiling; never applied to offline renders.
                        out = np.clip(out * self.gain, -0.98, 0.98)
                        if out.shape[0] == 1:
                            out = np.repeat(out, 2, axis=0)
                        stream.write(out, self.sr)
                    position = end if end < self.audio.shape[1] else 0
        except Exception as exc:
            self.error = exc
            self.failed.set()  # closes an open native editor too
        finally:
            self.ready.set()

    def check(self):
        if self.error:
            raise RuntimeError(f'Audition failed: {self.error}')

    def __exit__(self, *exc):
        self.stop.set()
        self.thread.join(timeout=10)
        if self.thread.is_alive():
            raise RuntimeError('Audio output did not stop; preset was not saved.')
        self.check()


def loop_source(args):
    return_audio, sr = read_audio(Path(args.audio).expanduser(), args.start, args.duration)
    return channels(return_audio, args.mono), sr


def cmd_capture_edit(args):
    from pedalboard import Pedalboard, load_plugin
    root = args.workspace
    # Decode first so a bad source cannot leave an open plugin editor.
    audio, sr = loop_source(args)
    with registry_lock(root):
        registry = read_registry(root)
        previous = registry['chains'].get(args.chain)
        if args.command == 'capture':
            if previous and not args.force:
                raise ValueError(f'Chain {args.chain!r} exists; use edit or --force.')
            entries = [plugin_entry(spec) for spec in args.plugins]
            plugins = [load_plugin(e['plugin'], plugin_name=e['plugin_name']) for e in entries]
            for plugin in plugins:
                prepare_plugin(plugin, sr)
        else:
            if previous is None:
                raise ValueError(f'Unknown chain: {args.chain}')
            entries = previous['plugins']
            plugins = [load_entry(root, e, sr) for e in entries]
        board = Pedalboard(plugins)
        save = False
        with LoopPlayer(board, audio, sr, args.device, args.monitor_db) as player:
            print('Looping through the full chain. Close each editor to continue.', flush=True)
            for i, plugin in enumerate(plugins):
                print(f'[{i + 1}/{len(plugins)}] {plugin.name}', flush=True)
                plugin.show_editor(close_event=player.failed)
                player.check()
            while True:
                print('Editors: ' + ', '.join(f'{i + 1}={p.name}' for i, p in enumerate(plugins)))
                choice = input('Number to reopen, s to save, q to discard: ').strip().lower()
                player.check()
                if choice in ('s', 'q'):
                    save = choice == 's'
                    break
                if choice.isdigit() and 1 <= int(choice) <= len(plugins):
                    plugins[int(choice) - 1].show_editor(close_event=player.failed)
                    player.check()
        if save:
            chain = save_chain(root, registry, args.chain, entries, plugins)
            print(f'Saved {args.chain!r}, revision {chain["revision"]}.')
        else:
            print('Discarded session changes.')


def cmd_audition(args):
    from pedalboard import Pedalboard
    chain = get_chain(args.workspace, args.chain)
    audio, sr = loop_source(args)
    board = Pedalboard([load_entry(args.workspace, e, sr) for e in chain['plugins']])
    with LoopPlayer(board, audio, sr, args.device, args.monitor_db) as player:
        print('Looping saved chain (no preset changes).', flush=True)
        if args.seconds:
            player.failed.wait(args.seconds)
        else:
            input('Press Enter to stop: ')
        player.check()


def cmd_list(args):
    for name, chain in read_registry(args.workspace)['chains'].items():
        print(f'{name}: ' + ' -> '.join(e['label'] for e in chain['plugins']))


def chain_folder(name):
    slug = re.sub(r'[^a-z0-9_-]+', '-', name.lower()).strip('-_')[:60] or 'chain'
    return slug + '-' + digest(name.encode())[:12]


def plan_render(source, output, names, recursive):
    source, output = source.resolve(strict=True), output.resolve()
    if source == output or (source.is_dir() and output.is_relative_to(source)):
        raise ValueError('Output must be outside the input folder and differ from the source.')
    files = ([source] if source.is_file() else sorted(
        p for p in source.glob('**/*' if recursive else '*')
        if p.is_file() and p.suffix.lower() in AUDIO_EXTS))
    if not files:
        raise ValueError(f'No audio files found in {source}')
    base = source.parent if source.is_file() else source
    result, seen = [], set()
    for name in names:
        for src in files:
            # Keep the original extension so kick.aif and kick.wav never collide.
            relative = src.relative_to(base)
            dest = output / chain_folder(name) / relative.parent / (relative.name + '.wav')
            key = str(dest).casefold()
            if key in seen:
                raise ValueError(f'Output filename collision: {dest}')
            if dest.resolve() == src.resolve():
                raise ValueError('Refusing to replace source audio.')
            seen.add(key)
            result.append((name, src, dest))
    return result


def process(board, audio, sr, tail, trim, normalize, mono):
    import numpy as np
    audio = channels(audio, mono)
    length = audio.shape[1]
    audio = np.pad(audio, ((0, 0), (0, int(round(tail * sr)))))
    # Each render worker creates fresh plugins, prepares them, then restores the
    # preset. Resetting again here resets Decapitator AU to its factory settings.
    out = board(audio, sr, reset=False)
    if out.ndim != 2 or not out.shape[1] or not np.isfinite(out).all():
        raise ValueError('Plugin returned empty or non-finite audio.')
    if out.shape[1] < length:
        raise ValueError('Plugin returned less audio than the source; refusing a truncated render.')
    if trim is not None:
        loud = np.flatnonzero(np.max(np.abs(out), axis=0) > 10 ** (trim / 20))
        end = max(int(loud[-1]) + 1 if loud.size else 0, length)
        out = out[:, :end]
    peak = float(np.max(np.abs(out)))
    if normalize is not None and peak > 0:
        out = out * (10 ** (normalize / 20) / peak)
    elif peak > 1:
        print(f'Warning: {20 * math.log10(peak):+.2f} dBFS peak will clip in 24-bit WAV.', flush=True)
    return out


def render_worker(job):
    from pedalboard import Pedalboard
    from pedalboard.io import AudioFile
    root, src, dest = (Path(job[k]) for k in ('workspace', 'input', 'output'))
    result = {'status': 'failed', 'started_at': now()}
    temporary = None
    try:
        before = file_hash(src)
        if before != job['input_sha256']:
            raise ValueError('Input changed since the job was queued.')
        audio, sr = read_audio(src)
        board = Pedalboard([load_entry(root, e, sr) for e in job['chain']['plugins']])
        settings = job['settings']
        out = process(board, audio, sr, **settings)
        if file_hash(src) != before:
            raise ValueError('Input changed during rendering.')
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='.resample-', suffix='.wav', dir=dest.parent)
        os.close(fd)
        temporary = Path(name)
        with AudioFile(str(temporary), 'w', sr, num_channels=out.shape[0], bit_depth=24) as f:
            f.write(out)
        output_hash = file_hash(temporary)
        publish(temporary, dest, job['overwrite'])
        import numpy as np
        peak = float(np.max(np.abs(out)))
        result.update(status='success', output_sha256=output_hash, sample_rate=sr,
                      channels=out.shape[0], frames=out.shape[1],
                      peak_before_encoding=peak, clipped=peak > 1)
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    result['finished_at'] = now()
    return result


def cmd_render(args):
    registry = read_registry(args.workspace)['chains']
    names = [n.strip() for n in args.chains.split(',')] if args.chains else list(registry)
    if not names or len(set(names)) != len(names):
        raise ValueError('Select at least one chain, without duplicates.')
    for name in names:
        if name not in registry:
            raise ValueError(f'Unknown chain: {name}')
        for entry in registry[name]['plugins']:
            state_file(args.workspace, entry)
    plan = plan_render(Path(args.input).expanduser(), Path(args.output).expanduser(), names, args.recursive)
    job_dir = args.workspace / 'jobs' / uuid.uuid4().hex
    job_dir.mkdir(parents=True)
    manifest = {'version': 1, 'created_at': now(), 'environment': environment(), 'jobs': []}
    manifest_path = job_dir / 'manifest.json'
    failed = 0
    for index, (name, src, dest) in enumerate(plan):
        job = {'workspace': str(args.workspace), 'input': str(src), 'output': str(dest),
               'chain_name': name, 'chain': registry[name], 'overwrite': args.overwrite,
               'settings': {k: getattr(args, k) for k in ('tail', 'trim', 'normalize', 'mono')}}
        manifest['jobs'].append(job)
        if dest.exists() and not args.overwrite:
            job['result'] = {'status': 'skipped', 'reason': 'output exists'}
        else:
            try:
                job['input_sha256'] = file_hash(src)
                request, response = job_dir / f'{index}.request.json', job_dir / f'{index}.result.json'
                write_json(request, job)
                write_json(manifest_path, manifest)
                # Native crashes cannot kill the batch parent. A timeout also bounds hung plugins.
                with (job_dir / f'{index}.log').open('w') as log:
                    completed = subprocess.run(
                        [sys.executable, str(Path(__file__).resolve()), '_worker', str(request), str(response)],
                        stdout=log, stderr=subprocess.STDOUT, timeout=args.timeout, check=False)
                if response.exists():
                    job['result'] = json.loads(response.read_text())
                else:
                    job['result'] = {'status': 'failed', 'error': f'Worker exited {completed.returncode}; see {index}.log'}
            except Exception as exc:
                job['result'] = {'status': 'failed', 'error': f'{type(exc).__name__}: {exc}'}
            if job['result']['status'] != 'success':
                failed += 1
        write_json(manifest_path, manifest)
        print(f'{job["result"]["status"]}: {src.name} -> {dest}', flush=True)
        if 'error' in job['result']:
            print('  ' + job['result']['error'], flush=True)
        if job['result'].get('clipped'):
            print('  Warning: output clipped; consider --normalize -1.', flush=True)
    manifest['finished_at'] = now()
    write_json(manifest_path, manifest)
    print(f'Job manifest: {manifest_path}')
    if failed:
        raise ValueError(f'{failed} render(s) failed. See manifest and worker logs.')


def environment():
    return {'python': platform.python_version(), 'platform': platform.platform(),
            'architecture': platform.machine(), 'script_sha256': file_hash(Path(__file__)),
            'packages': {name: importlib.metadata.version(name) for name in ('pedalboard', 'numpy')}}


def cmd_probe(args):
    """Run each plugin in its own process; never show editors or play audio."""
    root = args.workspace
    root.mkdir(parents=True, exist_ok=True)
    failures = 0
    for spec in args.plugins:
        with tempfile.TemporaryDirectory(prefix='probe-', dir=root) as directory:
            request, response = Path(directory) / 'request.json', Path(directory) / 'result.json'
            write_json(request, plugin_entry(spec))
            try:
                completed = subprocess.run([sys.executable, str(Path(__file__).resolve()),
                                            '_probe', str(request), str(response)],
                                           timeout=args.timeout, check=False)
                if completed.returncode or not response.exists():
                    raise RuntimeError(f'Probe worker exited {completed.returncode}')
                result = json.loads(response.read_text())
                print(json.dumps(result, indent=2))
                failures += result['status'] != 'success'
            except (subprocess.TimeoutExpired, RuntimeError) as exc:
                failures += 1
                print(f'FAILED {spec}: {exc}')
    if failures:
        raise ValueError(f'{failures} plugin probe(s) failed.')


def probe_worker(entry):
    import numpy as np
    from pedalboard import Pedalboard, load_plugin
    result = {**entry, 'environment': environment(), 'status': 'failed'}
    try:
        plugin = load_plugin(entry['plugin'], plugin_name=entry['plugin_name'])
        prepare_plugin(plugin)
        # Exercise a non-default setting so restoring defaults cannot pass the probe.
        parameters = plugin.parameters
        key = 'drive' if 'drive' in parameters else next((k for k in parameters if k != 'bypass'), None)
        if key is None:
            raise ValueError('No editable host parameter available for a non-default restore probe.')
        parameters[key].raw_value = 0.37 if abs(parameters[key].raw_value - 0.37) > .01 else 0.63
        expected_parameter = parameters[key].raw_value
        state = plugin.raw_state
        if not state:
            raise ValueError('Plugin returned empty state after preparation.')
        restored = load_plugin(entry['plugin'], plugin_name=entry['plugin_name'])
        prepare_plugin(restored)
        restored.raw_state = state
        sr = 44100
        t = np.arange(sr, dtype=np.float32) / sr
        signal = np.repeat((0.1 * np.sin(2 * np.pi * 220 * t))[None, :], 2, axis=0)
        original = process(Pedalboard([plugin]), signal, sr, 1, None, None, 'stereo')
        out = process(Pedalboard([restored]), signal, sr, 1, None, None, 'stereo')
        if abs(restored.parameters[key].raw_value - expected_parameter) > 1e-5:
            raise ValueError(f'Parameter {key} was not preserved through restore and processing.')
        if abs(plugin.parameters[key].raw_value - expected_parameter) > 1e-5:
            raise ValueError(f'Parameter {key} was reset during processing.')
        peak = float(np.max(np.abs(out)))
        if peak == 0:
            raise ValueError('Plugin produced silence from a non-silent test signal.')
        result.update(status='success', label=restored.name, state_bytes=len(state),
                      state_sha256=digest(state), frames=out.shape[1], peak=peak,
                      tested_parameter=key, restored_raw_value=restored.parameters[key].raw_value,
                      restored_vs_original_max_difference=float(np.max(np.abs(original - out))),
                      reported_latency_samples=restored.reported_latency_samples)
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
    return result


def number(value):
    parsed = float(value)
    if not math.isfinite(parsed):
        raise argparse.ArgumentTypeError('Must be finite.')
    return parsed


def nonnegative(value):
    parsed = number(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError('Must be zero or positive.')
    return parsed


def positive(value):
    parsed = number(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError('Must be positive.')
    return parsed


def db(value):
    parsed = number(value)
    if parsed > 0 or parsed < -160:
        raise argparse.ArgumentTypeError('Must be between -160 and 0 dBFS.')
    return parsed


def chain_name(value):
    if not value.strip() or ',' in value or any(ord(c) < 32 for c in value):
        raise argparse.ArgumentTypeError('Chain names must be nonempty and contain no commas/control characters.')
    return value


def parser():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--workspace', type=Path, default=DEFAULT_WORKSPACE,
                    help='Local preset/job storage (default: apps/internal/media/resampling).')
    sub = ap.add_subparsers(dest='command', required=True)
    for command in ('capture', 'edit', 'audition'):
        p = sub.add_parser(command)
        p.add_argument('chain', type=chain_name)
        if command == 'capture':
            p.add_argument('plugins', nargs='+', help='Bundle paths; path::Name for shell plugins.')
            p.add_argument('--force', action='store_true')
        p.add_argument('--audio', required=True, help='Audio file to loop through the entire chain.')
        p.add_argument('--start', type=nonnegative, default=0)
        p.add_argument('--duration', type=positive, default=8, help='Loop excerpt length in seconds (default 8).')
        p.add_argument('--mono', choices=('preserve', 'stereo'), default='stereo')
        p.add_argument('--device', default='default', help='Output device name; see devices command.')
        p.add_argument('--monitor-db', type=db, default=-12, help='Monitor-only gain, default -12 dB; hard ceiling at 0.98.')
        if command == 'audition':
            p.add_argument('--seconds', type=positive, help='Stop automatically after this many seconds.')
        p.set_defaults(func=cmd_audition if command == 'audition' else cmd_capture_edit)
    sub.add_parser('list').set_defaults(func=cmd_list)
    sub.add_parser('devices').set_defaults(func=cmd_devices)
    p = sub.add_parser('probe', help='Isolated state-restore/audio smoke test; no editors or playback.')
    p.add_argument('plugins', nargs='+')
    p.add_argument('--timeout', type=positive, default=60)
    p.set_defaults(func=cmd_probe)
    p = sub.add_parser('render')
    p.add_argument('input', help='Audio file or folder.')
    p.add_argument('output', help='Output folder outside the input folder.')
    p.add_argument('--chains', help='Comma-separated names; default all chains.')
    p.add_argument('--tail', type=nonnegative, default=4)
    p.add_argument('--trim', type=db)
    p.add_argument('--normalize', type=db)
    p.add_argument('--mono', choices=('preserve', 'stereo'), default='stereo')
    p.add_argument('--recursive', action='store_true')
    p.add_argument('--overwrite', action='store_true')
    p.add_argument('--timeout', type=positive, default=600, help='Maximum seconds per render worker.')
    p.set_defaults(func=cmd_render)
    return ap


def cmd_devices(args):
    from pedalboard.io import AudioStream
    print('Default:', AudioStream.default_output_device_name)
    for name in AudioStream.output_device_names:
        print(name)


def main():
    if len(sys.argv) == 4 and sys.argv[1] in ('_worker', '_probe'):
        job = json.loads(Path(sys.argv[2]).read_text())
        result = render_worker(job) if sys.argv[1] == '_worker' else probe_worker(job)
        write_json(Path(sys.argv[3]), result)
        return 0 if result['status'] == 'success' else 1
    args = parser().parse_args()
    args.workspace = args.workspace.expanduser().resolve()
    try:
        args.func(args)
        return 0
    except KeyboardInterrupt:
        print('\nCancelled; unsaved editor changes were discarded.', file=sys.stderr)
        return 130
    except Exception as exc:
        print(f'Error: {exc}', file=sys.stderr)
        if isinstance(exc, ModuleNotFoundError):
            print('Use the virtual environment from scripts/requirements-resample.txt.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
