"""
Lokální meteo apka: každých 10 minut stáhne data ze stanice a zobrazuje web.

  python server.py            spustí na portu 8765
  python server.py 9000       jiný port

Apka je pak dostupná na tomto PC (http://localhost:8765) i na mobilu/tabletu
ve stejné Wi-Fi (adresu vypíše při startu).
"""

import functools
import http.server
import os
import socket
import socketserver
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect  # noqa: E402
import forecast  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
INTERVAL = 10 * 60
WEB_DIR = os.path.join(collect.ROOT, "web")


def collector_loop():
    while True:
        try:
            row = collect.collect_once()
            print(time.strftime("%H:%M"), f"staženo: {row['t']} °C", flush=True)
        except Exception as e:
            print(time.strftime("%H:%M"), "stažení se nepovedlo:", e, flush=True)
        try:
            collect.build()
        except Exception as e:
            print("přepočet se nepovedl:", e, flush=True)
        try:
            forecast.update()
        except Exception as e:
            print("předpověď se nepovedla:", e, flush=True)
        time.sleep(INTERVAL)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # data vždy čerstvá, ostatní soubory si prohlížeč aspoň ověří (aby se projevily úpravy)
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/data/") else "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass  # netřeba vypisovat každý požadavek


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.0.1", 80))  # nic se neposílá, jen zjistí adresu v síti
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    threading.Thread(target=collector_loop, daemon=True).start()
    handler = functools.partial(Handler, directory=WEB_DIR)
    with Server(("0.0.0.0", PORT), handler) as httpd:
        print("Meteo apka běží.")
        print(f"  Na tomto PC:   http://localhost:{PORT}")
        ip = lan_ip()
        if ip:
            print(f"  Mobil ve Wi-Fi: http://{ip}:{PORT}")
        print("Zavřením tohoto okna se apka vypne.", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
