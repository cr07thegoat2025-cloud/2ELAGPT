from pathlib import Path
import subprocess
from PIL import Image

root = Path("android/app/src/main/res")
tmp = Path("/tmp/2elagpt-banana-icon.png")
subprocess.run(["rsvg-convert", "-w", "1024", "-h", "1024", "assets/banana-app-icon.svg", "-o", str(tmp)], check=True)
image = Image.open(tmp).convert("RGBA")
sizes = {"mdpi":48, "hdpi":72, "xhdpi":96, "xxhdpi":144, "xxxhdpi":192}
for density, size in sizes.items():
    folder = root / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon = image.resize((size, size), Image.Resampling.LANCZOS)
    icon.save(folder / "ic_launcher.png", optimize=True)
    icon.save(folder / "ic_launcher_round.png", optimize=True)

drawable = root / "drawable-nodpi"
drawable.mkdir(parents=True, exist_ok=True)
image.save(drawable / "ic_launcher_foreground.png", optimize=True)
adaptive = root / "mipmap-anydpi-v26"
adaptive.mkdir(parents=True, exist_ok=True)
xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@android:color/white" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
'''
(adaptive / "ic_launcher.xml").write_text(xml)
(adaptive / "ic_launcher_round.xml").write_text(xml)
