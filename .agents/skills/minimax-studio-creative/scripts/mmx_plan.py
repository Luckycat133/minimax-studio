#!/usr/bin/env python3
"""Run the pinned MiniMax CLI with an explicitly selected Token Plan account."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


PACKAGE = "mmx-cli@1.0.29"
ENTRY_SHA256 = "f70cc9e43e141192fcdb69eb80577b15fcfac7a6c5a8341e90ca6d2ad1fc0522"
COMMANDS = {
    ("quota", "show"), ("text", "chat"), ("image", "generate"),
    ("video", "generate"), ("video", "task", "get"), ("video", "download"),
    ("speech", "synthesize"), ("speech", "voices"), ("speech", "transcribe"),
    ("vision", "describe"), ("search", "query"), ("file", "upload"), ("file", "list"),
}
OFFLINE_FLAGS = {"--help", "-h", "--version", "-v"}
BLOCKED_FLAGS = {"apikey", "baseurl", "region", "verbose", "proxy", "config", "configdir"}
TOOL_NAMES = {"mmx_" + "_".join(command) for command in COMMANDS}
FIND_ENTRY = """
const {realpathSync} = require('node:fs');
const path = require('node:path');
for (const directory of process.env.PATH.split(path.delimiter)) {
  try {
    const entry = realpathSync(path.join(directory, 'mmx'));
    if (entry.endsWith(path.join('mmx-cli', 'dist', 'mmx.mjs'))) {
      console.log(entry);
      process.exit(0);
    }
  } catch {}
}
process.exit(1);
"""

# The pinned CLI's request path reads the parsed flag, not the env variable.
# Keep the key private to the Node process rather than adding it to OS argv.
PRELOAD = """
const key = process.env.MINIMAX_API_KEY;
delete process.env.MINIMAX_API_KEY;
if (key) process.argv.splice(2, 0, '--api-key=' + key);
"""

# MMX 1.0.29 writes the final aggregate as another chunk. Request only
# incremental audio using MiniMax's documented T2A stream option.
TTS_STREAM_OPTIONS = """
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (options?.method === 'POST' && typeof options.body === 'string' &&
      ['https://api.minimax.cn/v1/t2a_v2', 'https://api.minimax.io/v1/t2a_v2'].includes(String(url))) {
    const body = JSON.parse(options.body);
    if (body.stream === true) {
      body.stream_options = {...body.stream_options, exclude_aggregated_audio: true};
      return originalFetch(url, {...options, body: JSON.stringify(body)});
    }
  }
  return originalFetch(url, options);
};
"""


class PlanError(Exception):
    """A user-correctable error before launching the MiniMax CLI."""


def check_command(arguments):
    if not arguments or "--" in arguments:
        raise PlanError("supply an mmx command after the wrapper's -- separator")
    for argument in arguments:
        if argument.startswith("--"):
            flag = argument[2:].partition("=")[0].lower().replace("-", "").replace("_", "")
            if flag in BLOCKED_FLAGS:
                raise PlanError("mmx cannot override authentication, region, endpoint, configuration or logging")
            if flag == "noninteractive" and argument not in {"--non-interactive", "--non-interactive=true"}:
                raise PlanError("mmx requires non-interactive mode")
    if len(arguments) == 1 and arguments[0] in OFFLINE_FLAGS:
        return arguments, "help"
    if arguments[:2] == ["config", "export-schema"]:
        return arguments, "help" if OFFLINE_FLAGS.intersection(arguments) else "schema"
    if arguments[0] == "quota" and (len(arguments) == 1 or arguments[1].startswith("-")):
        arguments = ["quota", "show", *arguments[1:]]
    if not any(tuple(arguments[:len(command)]) == command for command in COMMANDS):
        raise PlanError("unsupported command for this Token Plan runner")
    if OFFLINE_FLAGS.intersection(arguments):
        return arguments, "help"
    mode = "dry-run" if {"--dry-run", "--dry-run=true"}.intersection(arguments) else "request"
    return arguments, mode


def option_value(arguments, name):
    values = []
    for index, argument in enumerate(arguments):
        if argument == name:
            value = arguments[index + 1] if index + 1 < len(arguments) else ""
        elif argument.startswith(name + "="):
            value = argument.partition("=")[2]
        else:
            continue
        if not value or value.startswith("--"):
            raise PlanError(f"supply a value for {name}")
        values.append(value)
    if len(values) > 1:
        raise PlanError(f"supply {name} only once")
    return values[0] if values else None


def check_outputs(arguments):
    output = option_value(arguments, "--out")
    directory = option_value(arguments, "--out-dir")
    download = option_value(arguments, "--download")
    if arguments[:2] == ["video", "download"] and output is None:
        raise PlanError("supply an explicit new --out path for video download")
    if arguments[:2] == ["video", "generate"] and download is not None and (
        {"--async", "--async=true", "--no-wait", "--no-wait=true"}.intersection(arguments)
    ):
        raise PlanError("async video returns a task ID; download separately after completion")
    subtitles = any(arg == "--subtitles" or arg.startswith("--subtitles=") for arg in arguments)
    if arguments[:2] == ["speech", "synthesize"] and subtitles:
        if output is None or not Path(output).suffix:
            raise PlanError("supply an --out filename with an extension when writing subtitles")
        subtitle = re.sub(r"\.[^.]+$", "", output) + ".srt"
    else:
        subtitle = None
    for value in (output, download, subtitle):
        if value is not None and os.path.lexists(value):
            raise PlanError(f"output path already exists: {value}")
    if directory is not None:
        path = Path(directory)
        if path.is_symlink() or (path.exists() and (not path.is_dir() or any(path.iterdir()))):
            raise PlanError(f"choose a new or empty output directory: {directory}")


def token(service):
    if service is not None:
        if sys.platform != "darwin":
            raise PlanError("Keychain lookup requires macOS")
        lookup = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-a", getpass.getuser(), "-s", service, "-w"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            check=False, timeout=15,
        )
        if lookup.returncode:
            raise PlanError("could not read the requested Keychain item")
        key = lookup.stdout.decode("ascii", errors="replace").rstrip("\r\n")
    else:
        key = os.environ.get("MINIMAX_TOKEN_PLAN_KEY")
    if key is None:
        raise PlanError("set MINIMAX_TOKEN_PLAN_KEY or choose a macOS Keychain service")
    if not re.fullmatch(r"sk-cp-[A-Za-z0-9._~-]+", key):
        raise PlanError("the selected credential must be a MiniMax Token Plan key (sk-cp-…)")
    return key


def executable(name):
    path = shutil.which(name)
    if path is None:
        raise PlanError(f"{name} is required to run the pinned MiniMax CLI")
    return str(Path(path).resolve())


def isolated_environment(folder, node):
    node_directory = str(Path(node).parent)
    env = {
        "HOME": str(folder), "MMX_CONFIG_DIR": str(folder / "mmx"),
        "PATH": os.pathsep.join((node_directory, os.defpath)), "CI": "1", "NO_COLOR": "1",
    }
    if os.name == "nt":
        env["USERPROFILE"] = str(folder)
        if "SystemRoot" in os.environ:
            env["SystemRoot"] = os.environ["SystemRoot"]
    return env


def installed_entry(explicit, folder, node, env):
    if explicit is not None:
        entry = explicit.expanduser().resolve(strict=True)
    else:
        npm = executable("npm")
        result = subprocess.run(
            [npm, f"--userconfig={folder / 'user.npmrc'}", f"--globalconfig={folder / 'global.npmrc'}",
             f"--cache={Path.home() / '.npm'}", "--registry=https://registry.npmjs.org", "--ignore-scripts",
             "exec", "--yes", f"--package={PACKAGE}", "--", node, "-e", FIND_ENTRY],
            cwd=folder, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, check=False,
        )
        if result.returncode or not result.stdout.strip():
            raise PlanError(f"could not resolve {PACKAGE} through npm (exit {result.returncode})")
        entry = Path(result.stdout.strip()).resolve(strict=True)
    if not entry.is_file() or hashlib.sha256(entry.read_bytes()).hexdigest() != ENTRY_SHA256:
        raise PlanError(f"the mmx entry does not match the official {PACKAGE} build")
    return entry


def run_mmx(node, entry, arguments, region, mode, key, folder, env):
    invocation = [node]
    child_env = env.copy()
    if mode != "help":
        preload = folder / "private-auth.cjs"
        source = PRELOAD
        if mode == "request" and arguments[:2] == ["speech", "synthesize"]:
            source += TTS_STREAM_OPTIONS
        preload.write_text(source, encoding="utf-8")
        invocation.extend(["--require", str(preload)])
        # The pinned CLI runs its auth guard for schema and dry-run commands.
        child_env["MINIMAX_API_KEY"] = key if mode == "request" else "offline-command-placeholder"
    invocation += [str(entry), "--region", region, "--non-interactive", "--no-color", *arguments]
    if mode == "schema":
        return print_schema(invocation, child_env)
    stdin = None if mode in {"request", "dry-run"} else subprocess.DEVNULL
    secret = key.encode("ascii") if key else None
    with subprocess.Popen(invocation, env=child_env, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as child:
        with ThreadPoolExecutor(max_workers=2) as workers:
            stdout = workers.submit(relay_output, child.stdout, sys.stdout.buffer, secret)
            stderr = workers.submit(relay_output, child.stderr, sys.stderr.buffer, secret)
            try:
                status = child.wait()
            except KeyboardInterrupt:
                # Closing pipes alone can leave a generation alive in the background.
                child.terminate()
                raise
            stdout.result()
            stderr.result()
    return status if status >= 0 else 128 - status


def relay_output(source, destination, secret):
    retained = b""
    for chunk in iter(lambda: source.read1(65536), b""):
        data = retained + chunk
        if secret:
            data = data.replace(secret, b"[REDACTED]")
            # Retain only the suffix that could begin a credential across pipe reads.
            size = min(len(data), len(secret) - 1)
            while size and not secret.startswith(data[-size:]):
                size -= 1
            data, retained = (data[:-size], data[-size:]) if size else (data, b"")
        destination = write_to_pipe(destination, data)
    write_to_pipe(destination, retained)


def write_to_pipe(destination, data):
    if destination is not None and data:
        try:
            destination.write(data)
            destination.flush()
        except BrokenPipeError:
            return None
    return destination


def print_schema(invocation, env):
    result = subprocess.run(invocation, env=env, stdin=subprocess.DEVNULL, capture_output=True, check=False)
    sys.stderr.buffer.write(result.stderr)
    if result.returncode != 0:
        return result.returncode
    try:
        schema = json.loads(result.stdout)
    except (ValueError, UnicodeError) as error:
        raise PlanError("the CLI returned an invalid tool schema") from error
    options = schema if isinstance(schema, list) else [schema]
    allowed = [tool for tool in options if isinstance(tool, dict) and tool.get("name") in TOOL_NAMES]
    if not isinstance(schema, list) and not allowed:
        raise PlanError("schema is outside the Token Plan runner's supported commands")
    print(json.dumps(allowed if isinstance(schema, list) else allowed[0], ensure_ascii=False, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", required=True, choices=("cn", "global"))
    parser.add_argument("--keychain-service", metavar="SERVICE")
    parser.add_argument("--mmx", type=Path, metavar="PATH", help=f"verified {PACKAGE} entry or symlink")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command[:1] != ["--"]:
        parser.error("separate the mmx command with --")
    try:
        arguments, mode = check_command(args.command[1:])
        if mode == "request":
            check_outputs(arguments)
        node = executable("node")
        with tempfile.TemporaryDirectory(prefix="studio-mmx-") as temp:
            folder = Path(temp).resolve()
            env = isolated_environment(folder, node)
            entry = installed_entry(args.mmx, folder, node, env)
            key = token(args.keychain_service) if mode == "request" else None
            if key is not None and any(key in argument for argument in arguments):
                raise PlanError("keep the credential out of mmx arguments")
            return run_mmx(node, entry, arguments, args.region, mode, key, folder, env)
    except subprocess.TimeoutExpired:
        print("MiniMax Token Plan: the Keychain lookup did not finish", file=sys.stderr)
        return 2
    except (OSError, PlanError) as error:
        print(f"MiniMax Token Plan: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
