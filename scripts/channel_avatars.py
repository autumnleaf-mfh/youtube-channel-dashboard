"""Cache public channel avatars inside the snapshot for cross-device loading."""
import base64
import concurrent.futures
import shutil
import subprocess
import urllib.parse
import urllib.request


def fetch_avatar(url):
    parsed = urllib.parse.urlsplit(url or '')
    if parsed.scheme != 'https' or parsed.hostname not in {'yt3.ggpht.com', 'yt3.googleusercontent.com'} or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('Unsupported avatar origin')
    command = [shutil.which('curl.exe') or shutil.which('curl') or 'curl', '--fail', '--silent', '--show-error', '--max-time', '20', '--max-filesize', '1048576', '--proto', '=https']
    proxy = urllib.request.getproxies().get('https')
    if proxy:
        command += ['--proxy', proxy]
    result = subprocess.run(command + [url], capture_output=True, timeout=25)
    raw = result.stdout
    if result.returncode or not raw or len(raw) > 1048576:
        raise ValueError('Avatar download failed')
    mime = ('image/jpeg' if raw.startswith(b'\xff\xd8\xff') else
            'image/png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else
            'image/webp' if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP' else None)
    if mime is None:
        raise ValueError('Unsupported avatar image')
    return 'data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii')


def cache_avatars(rows, previous_rows):
    previous = {row['channelId']: row for row in previous_rows}
    def enrich(row):
        old = previous.get(row['channelId'], {})
        cached = old.get('avatarDataUrl', '')
        if cached.startswith(('data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/webp;base64,')):
            row['avatarDataUrl'] = cached
            row['avatarSourceUrl'] = old.get('avatarSourceUrl')
            if row.get('thumbnail') == row['avatarSourceUrl']:
                return
        if row.get('thumbnail'):
            try:
                row['avatarDataUrl'] = fetch_avatar(row['thumbnail'])
                row['avatarSourceUrl'] = row['thumbnail']
            except (ValueError, OSError, subprocess.SubprocessError):
                # Keep the last valid avatar when a replacement cannot be fetched.
                pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(enrich, rows))


if __name__ == '__main__':
    import argparse
    import json
    from pathlib import Path
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshot', type=Path)
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text(encoding='utf-8'))
    rows = snapshot['queries']['channel_current']['rows']
    cache_avatars(rows, [dict(row) for row in rows])
    # This is an asset-only enrichment; metric timestamps and measurements stay intact.
    args.snapshot.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'channels': len(rows), 'cached': sum(bool(row.get('avatarDataUrl')) for row in rows)}))
