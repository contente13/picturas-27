from urllib.request import urlopen


with urlopen("http://localhost:9100/health", timeout=4) as response:
    if response.status != 200:
        raise SystemExit(f"Health endpoint returned HTTP {response.status}")
