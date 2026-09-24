#!/usr/bin/env python3
"""Publish the latest dashboard snapshot to the GitHub Pages repository."""

import argparse
import base64
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

GIT = r"C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"
REPOSITORY = "autumnleaf-mfh/youtube-channel-dashboard"


def credential():
    result = subprocess.run(
        [GIT, "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        text=True,
        capture_output=True,
        check=True,
    )
    values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if not values.get("password"):
        raise RuntimeError("GitHub credential is unavailable")
    return values["password"]


def request(token, method, path, body=None):
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "faatchoi-youtube-dashboard-publisher",
    }
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(f"https://api.github.com{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    token = credential()
    status, existing = request(token, "GET", f"/repos/{REPOSITORY}/contents/data.json")
    body = {
        "message": "data: refresh YouTube metrics",
        "content": base64.b64encode(args.snapshot.read_bytes()).decode("ascii"),
        "branch": "main",
    }
    if status == 200:
        body["sha"] = existing["sha"]
    elif status != 404:
        raise RuntimeError(f"GitHub snapshot lookup failed: HTTP {status}")
    status, result = request(token, "PUT", f"/repos/{REPOSITORY}/contents/data.json", body)
    if status not in (200, 201):
        raise RuntimeError(f"GitHub snapshot publish failed: HTTP {status} {result.get('message', '')}")
    print(json.dumps({"published": True, "commit": result["commit"]["sha"]}))


if __name__ == "__main__":
    main()

