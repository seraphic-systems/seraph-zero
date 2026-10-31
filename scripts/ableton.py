"""Read-only Live Set analysis. Python standard library only."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import fcntl
import math
from pathlib import Path
import sys
import tempfile
import uuid
from xml.etree import ElementTree as ET


ANALYZER_VERSION = 2
SCHEMA_VERSION = 2
DEFAULT_REGISTRY = Path(__file__).resolve().parents[1] / "apps/internal/data/set-registry.json"
FORMATS = {"VstPluginInfo": "VST2", "Vst3PluginInfo": "VST3",
           "AuPluginInfo": "AU"}


def value(node, field):
    child = node.find(field)
    return child.get("Value") if child is not None else None


def analyze_set(source):
    """Count saved PluginDevice instances; never load plugins or alter a set."""
    raw = Path(source).read_bytes()
    return analyze_bytes(raw)


def project_bpm(live_set, warnings):
    """Read the saved main/master tempo, independently of scene tempos."""
    for track in ("MainTrack", "MasterTrack"):
        manual = live_set.find(f"{track}/DeviceChain/Mixer/Tempo/Manual")
        if manual is None:
            continue
        try:
            bpm = float(manual.get("Value", ""))
            if math.isfinite(bpm) and bpm > 0:
                return bpm
        except ValueError:
            pass
        warnings.add("Invalid saved project tempo; bpm is unavailable")
        return None
    return None


def analyze_bytes(raw):
    xml = gzip.decompress(raw) if raw.startswith(b"\x1f\x8b") else raw
    # Live Sets do not need DTDs. Reject them rather than expanding entities.
    if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
        raise ValueError("DTD/entity declarations are not supported")
    root = ET.fromstring(xml)
    if root.tag != "Ableton" or root.find("LiveSet") is None:
        raise ValueError("expected an Ableton LiveSet document")
    instances = []
    warnings = set()
    bpm = project_bpm(root.find("LiveSet"), warnings)
    for device in root.find("LiveSet").iter("PluginDevice"):
        desc = device.find("PluginDesc")
        info = next(iter(desc), None) if desc is not None else None
        tag = info.tag if info is not None else "MissingPluginDesc"
        fmt = FORMATS.get(tag, "unknown")
        if fmt == "unknown":
            warnings.add(f"Unrecognized plugin descriptor: {tag}; included in total")
        name = ((value(info, "PlugName") or value(info, "Name"))
                if info is not None else None) or "Unknown plugin"
        uid = value(info, "UniqueId") if info is not None else None
        if info is not None and info.find("Uid") is not None:
            uid = ":".join(n.get("Value", "") for n in info.find("Uid"))
        instances.append({"format": fmt, "name": name, "plugin_id": uid,
                          "device_on": value(device, "On/Manual")})
    groups = Counter((p["format"], p["name"], p["plugin_id"]) for p in instances)
    plugins = [{"format": fmt, "name": name, "plugin_id": uid, "instances": count}
               for (fmt, name, uid), count in sorted(groups.items(), key=lambda p: str(p[0]))]
    return {
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "xml_sha256": hashlib.sha256(xml).hexdigest(),
        "live_version": root.get("Creator"),
        "bpm": bpm,
        "external_plugin_instances": len(instances),
        "distinct_plugins": len(plugins),
        "instances_by_format": dict(sorted(Counter(p["format"] for p in instances).items())),
        "plugins": plugins,
        "warnings": sorted(warnings),
    }


def discover_sets(source):
    if source.is_file():
        return [source]
    if not source.is_dir():
        raise ValueError(f"source does not exist: {source}")
    return sorted(p for p in source.rglob("*")
                  if p.is_file() and p.suffix.lower() == ".als"
                  and not any(part.lower() == "backup" for part in p.relative_to(source).parts))


def path_key(file):
    resolved = Path(file).expanduser().resolve()
    try:
        return "~/" + resolved.relative_to(Path.home()).as_posix()
    except ValueError:
        return str(resolved)


def assign_ids(results, registry):
    """Match paths first, then unambiguous moved files. Copies get new IDs."""
    records = registry["sets"]
    by_path = {record["paths"][-1]: record for record in records}
    current = {result["source_path"] for result in results}
    used = set()
    for result in results:
        record = by_path.get(result["source_path"])
        if record:
            result["set_id"] = record["id"]
            used.add(record["id"])
    unmatched_hashes = Counter(r["xml_sha256"] for r in results if "set_id" not in r)
    for result in results:
        if "set_id" in result:
            continue
        candidates = [record for record in records
                      if record["id"] not in used
                      and record["xml_sha256"] == result["xml_sha256"]
                      and not any(Path(p).expanduser().exists() or p in current for p in record["paths"])]
        if len(candidates) == 1 and unmatched_hashes[result["xml_sha256"]] == 1:
            record = candidates[0]
            record["paths"].append(result["source_path"])
        else:
            record = {"id": str(uuid.uuid4()), "paths": [result["source_path"]],
                      "xml_sha256": result["xml_sha256"],
                      "created_at": datetime.now(timezone.utc).isoformat()}
            records.append(record)
        result["set_id"] = record["id"]
        used.add(record["id"])
    by_id = {record["id"]: record for record in records}
    for result in results:
        by_id[result["set_id"]]["xml_sha256"] = result["xml_sha256"]


def changed_sets(results, directory):
    """Compare with the latest saved analysis, not any historical matching hash."""
    latest = {}
    for file in sorted(directory.glob("*.json")):
        report = json.loads(file.read_text())
        if report["schema_version"] != SCHEMA_VERSION:
            continue  # Preserve old reports; create a baseline with permanent IDs.
        for result in report["sets"]:
            key = result["set_id"]
            if key not in latest or report["analyzed_at"] > latest[key][0]:
                latest[key] = (report["analyzed_at"], result["xml_sha256"], report["analyzer_version"])
    return [r for r in results if r["set_id"] not in latest
            or latest[r["set_id"]][1:] != (r["xml_sha256"], ANALYZER_VERSION)]


def save_registry(file, registry):
    serialized = json.dumps(registry, indent=2) + "\n"
    if file.exists() and file.read_text() == serialized:
        return
    with tempfile.NamedTemporaryFile(mode="w", dir=file.parent, prefix=f'.{file.name}.', suffix='.tmp', delete=False) as output:
        temporary = Path(output.name)
        output.write(serialized)
    try:
        temporary.replace(file)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default="~/Ableton", help=".als file or folder (default: ~/Ableton)")
    parser.add_argument("--json", action="store_true", help="print the complete JSON report")
    parser.add_argument("--snapshot", type=Path, help="save changed sets in this directory without overwriting history")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY, help="permanent set ID registry")
    parser.add_argument("--relink", nargs=2, metavar=("OLD_PATH", "NEW_PATH"),
                        help="preserve a set ID after a rename plus edits; old path must be absent")
    args = parser.parse_args()
    args.registry = args.registry.expanduser().resolve()
    args.registry.parent.mkdir(parents=True, exist_ok=True)
    # A scheduled run must not race another scan when assigning IDs or saving history.
    with args.registry.with_suffix(args.registry.suffix + ".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.exit(1, "another scan is using this registry\n")
        try:
            return run(args, parser)
        except (OSError, ValueError, KeyError) as error:
            parser.exit(1, f"{error}\n")


def run(args, parser):
    source = Path(args.source).expanduser().resolve()
    try:
        files = discover_sets(source)
        if not files:
            raise ValueError("no Live Sets found")
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    registry = json.loads(args.registry.read_text()) if args.registry.exists() else {"schema_version": 1, "sets": []}
    if registry["schema_version"] != 1:
        raise ValueError("unsupported set registry schema")
    if args.relink:
        old, new = map(path_key, args.relink)
        matches = [r for r in registry["sets"] if old in r["paths"]]
        if len(matches) != 1 or Path(old).expanduser().exists() or not Path(new).expanduser().is_file():
            raise ValueError("relink requires one known old path that is absent and an existing new file")
        if any(new in r["paths"] for r in registry["sets"]):
            raise ValueError("new path already has an identity; refusing to merge histories")
        analyze_set(Path(new).expanduser())
        matches[0]["paths"].append(new)
    created_at = datetime.now(timezone.utc).isoformat()
    report = {"schema_version": SCHEMA_VERSION, "analyzer_version": ANALYZER_VERSION,
              "created_at": created_at, "analyzed_at": created_at,
              "source": args.source, "sets": [], "errors": []}
    for file in files:
        relative = file.relative_to(source).as_posix() if source.is_dir() else file.name
        try:
            report["sets"].append({"set_path": relative, "source_path": path_key(file), **analyze_set(file)})
        except (OSError, ValueError, ET.ParseError, EOFError) as error:
            report["errors"].append({"set_path": relative, "error": str(error)})
    assign_ids(report["sets"], registry)
    if args.snapshot:
        args.snapshot = args.snapshot.expanduser()
        changes = changed_sets(report["sets"], args.snapshot)
        report["unchanged_sets"] = len(report["sets"]) - len(changes)
    save_registry(args.registry, registry)
    if args.snapshot:
        if changes or report["errors"]:
            args.snapshot.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            target = args.snapshot / f"{stamp}-{uuid.uuid4().hex[:8]}.json"
            with target.open("x") as output:
                json.dump({**report, "sets": changes}, output, indent=2, ensure_ascii=False)
                output.write("\n")
            print(f"Snapshot: {target} ({len(changes)} changed sets)", file=sys.stderr)
        else:
            print("No changed sets; no snapshot written.", file=sys.stderr)
    serialized = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.json:
        print(serialized, end="")
    else:
        for result in report["sets"]:
            print(f'{result["external_plugin_instances"]:3} instances / '
                  f'{result["distinct_plugins"]:2} distinct  {result["set_path"]}')
            for warning in result["warnings"]:
                print(f"    Warning: {warning}")
        print(f'{len(report["sets"])} sets; '
              f'{sum(r["external_plugin_instances"] for r in report["sets"])} external plugin instances')
    for error in report["errors"]:
        print(f'ERROR {error["set_path"]}: {error["error"]}', file=sys.stderr)
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
