"""
Sběrač dat z meteostanice na Weathercloudu.

  python collect.py                 jedno stažení aktuálních dat + přepočet
  python collect.py --import DIR    jednorázový import CSV exportů z Weathercloudu
  python collect.py --build         jen přepočítá JSONy pro web z uložených dat

Data:
  data/raw/YYYY-MM.csv   všechna měření (UTC čas v sekundách), jeden soubor na měsíc
  data/daystats.json     denní extrémy ze statistik Weathercloudu (zpřesňují denní min/max)
  web/data/*.json        hotové souhrny, které čte webová stránka
"""

import csv
import datetime as dt
import glob
import json
import os
import sys
import urllib.request

STATION = "5936966293"
BASE = "https://app.weathercloud.net"
ROOT = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(ROOT, "data", "raw")
DAYSTATS = os.path.join(ROOT, "data", "daystats.json")
OUT_DIR = os.path.join(ROOT, "web", "data")
RECENT_DAYS = 31

# t = teplota, tf = pocitová, dew = rosný bod, h = vlhkost, p = tlak,
# ws = průměrný vítr km/h, wg = nárazy km/h, wd = směr °, r = srážky od půlnoci mm, rr = intenzita mm/h
FIELDS = ["ts", "t", "tf", "dew", "h", "p", "ws", "wg", "wd", "r", "rr"]


# ---------------------------------------------------------------- čas (Europe/Prague)
def _last_sunday_utc(year, month):
    d = dt.datetime(year, month + 1, 1) - dt.timedelta(days=1) if month < 12 else dt.datetime(year, 12, 31)
    while d.weekday() != 6:
        d -= dt.timedelta(days=1)
    return d.replace(hour=1, tzinfo=dt.timezone.utc)  # přechod je v 01:00 UTC


def prague_offset(ts):
    """Posun pražského času vůči UTC (v sekundách) pro daný UTC timestamp."""
    y = dt.datetime.fromtimestamp(ts, dt.timezone.utc).year
    start = _last_sunday_utc(y, 3).timestamp()
    end = _last_sunday_utc(y, 10).timestamp()
    return 7200 if start <= ts < end else 3600


def local_dt(ts):
    return dt.datetime.fromtimestamp(ts + prague_offset(ts), dt.timezone.utc).replace(tzinfo=None)


def local_to_ts(naive):
    """Pražský místní čas -> UTC timestamp (dvojznačná hodina při přechodu bere letní čas)."""
    guess = naive.replace(tzinfo=dt.timezone.utc).timestamp()
    for off in (7200, 3600):
        if prague_offset(guess - off) == off:
            return int(guess - off)
    return int(guess - 3600)


# ---------------------------------------------------------------- úložiště měření
def month_key(ts):
    return local_dt(ts).strftime("%Y-%m")


def read_raw(path):
    rows = {}
    if not os.path.exists(path):
        return rows
    with open(path, newline="", encoding="utf-8") as f:
        for rec in csv.DictReader(f):
            row = {"ts": int(rec["ts"])}
            for k in FIELDS[1:]:
                v = rec.get(k, "")
                row[k] = float(v) if v not in ("", None) else None
            rows[row["ts"]] = row
    return rows


def write_raw(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(FIELDS)
        for ts in sorted(rows):
            r = rows[ts]
            w.writerow([ts] + ["" if r.get(k) is None else _fmt(r[k]) for k in FIELDS[1:]])
    os.replace(tmp, path)


def _fmt(v):
    v = round(v, 1)
    return str(int(v)) if v == int(v) else str(v)


def save_rows(new_rows):
    by_month = {}
    for r in new_rows:
        by_month.setdefault(month_key(r["ts"]), []).append(r)
    for m, rs in by_month.items():
        path = os.path.join(RAW_DIR, m + ".csv")
        existing = read_raw(path)
        for r in rs:
            existing[r["ts"]] = r
        write_raw(path, existing)


def load_all():
    rows = {}
    for path in sorted(glob.glob(os.path.join(RAW_DIR, "*.csv"))):
        rows.update(read_raw(path))
    return [rows[k] for k in sorted(rows)]


# ---------------------------------------------------------------- import CSV z Weathercloudu
def _num(s):
    s = s.strip().replace(",", "")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def import_csv_dir(folder):
    total = 0
    for path in sorted(glob.glob(os.path.join(folder, "*.csv"))):
        raw = open(path, "rb").read()
        if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
            text = raw.decode("utf-16")
        elif len(raw) > 1 and raw[1] == 0:
            text = raw.decode("utf-16-le")
        else:
            text = raw.decode("utf-8-sig")
        lines = [l for l in text.splitlines() if l.strip()]
        header = [h.strip() for h in lines[0].split(";")]

        def col(name):
            for i, h in enumerate(header):
                if h.lower().startswith(name.lower()):
                    return i
            return None

        c = {
            "date": 0,
            "t": col("Temperature"),
            "chill": col("Wind chill"),
            "heat": col("Heat index"),
            "dew": col("Dew point"),
            "h": col("Humidity"),
            "wg": col("Wind gust"),
            "ws": col("Average wind speed"),
            "wd": col("Average wind direction"),
            "p": col("Atmospheric pressure"),
            "r": col("Rain ("),
            "rr": col("Rain rate"),
        }
        rows, last_ts = [], 0
        for line in lines[1:]:
            parts = line.split(";")
            try:
                naive = dt.datetime.strptime(parts[0].strip(), "%d/%m/%Y %H:%M:%S")
            except ValueError:
                continue
            ts = local_to_ts(naive)
            if ts <= last_ts:  # druhý průchod hodinou při přechodu na zimní čas
                ts += 3600
            last_ts = ts

            def g(key):
                i = c[key]
                return _num(parts[i]) if i is not None and i < len(parts) else None

            t = g("t")
            if t is None:
                continue  # výpadek stanice
            heat, chill = g("heat"), g("chill")
            rows.append({
                "ts": ts, "t": t,
                "tf": heat if heat is not None else chill,
                "dew": g("dew"), "h": g("h"), "p": g("p"),
                "ws": g("ws"), "wg": g("wg"), "wd": g("wd"),
                "r": g("r"), "rr": g("rr"),
            })
        save_rows(rows)
        total += len(rows)
        print(f"  {os.path.basename(path)}: {len(rows)} měření")
    print(f"Importováno celkem {total} měření.")


# ---------------------------------------------------------------- stahování z Weathercloudu
def fetch_json(path):
    req = urllib.request.Request(BASE + path, headers={
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (meteo-dashboard)",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


MS_TO_KMH = 3.6
WIND_KEYS = ("wspd", "wspdhi", "wspdavg")


def _wind(key):
    return key.split("_")[0] in WIND_KEYS


def collect_once():
    values = fetch_json(f"/device/values?code={STATION}")
    stats = fetch_json(f"/device/stats?code={STATION}")

    # Bez přihlášení posílá Weathercloud vítr v m/s -> převod na km/h
    for k in WIND_KEYS:
        if values.get(k) is not None:
            values[k] = round(values[k] * MS_TO_KMH, 1)
    for k, v in stats.items():
        if _wind(k) and isinstance(v, list) and len(v) == 2 and v[1] is not None:
            stats[k] = [v[0], round(v[1] * MS_TO_KMH, 1)]

    ts = int(values["epoch"])
    temp = values.get("temp")
    feels = values.get("chill")
    if temp is not None and temp >= 26 and stats.get("heat_current"):
        feels = stats["heat_current"][1]
    row = {
        "ts": ts, "t": temp, "tf": feels, "dew": values.get("dew"), "h": values.get("hum"),
        "p": values.get("bar"), "ws": values.get("wspdavg", values.get("wspd")),
        "wg": values.get("wspdhi"), "wd": values.get("wdiravg", values.get("wdir")),
        "r": values.get("rain"), "rr": values.get("rainrate"),
    }
    if temp is not None:
        save_rows([row])

    _update_daystats(stats)

    current = {
        "fetched": int(dt.datetime.now(dt.timezone.utc).timestamp()),
        "values": {k: values.get(k) for k in
                   ("epoch", "temp", "chill", "dew", "hum", "bar", "wspd", "wspdhi", "wspdavg",
                    "wdir", "wdiravg", "rain", "rainrate")},
        "stats": {k: v for k, v in stats.items()
                  if k.split("_")[0] in ("temp", "hum", "bar", "wspd", "wspdhi", "rain", "rainrate", "dew", "chill", "heat")},
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    _write_json(os.path.join(OUT_DIR, "current.json"), current)
    return row


def _update_daystats(stats):
    """Uloží denní extrémy ze statistik – zpřesní min/max, i když stahujeme jen občas."""
    ds = {}
    if os.path.exists(DAYSTATS):
        with open(DAYSTATS, encoding="utf-8") as f:
            ds = json.load(f)

    def put(key, field, mode):
        v = stats.get(key)
        if not v or v[1] is None:
            return
        when = local_dt(v[0] + (60 if mode == "sum" else 0))
        rec = ds.setdefault(when.strftime("%Y-%m-%d"), {})
        old = rec.get(field)
        if old is None or (mode == "max" and v[1] > old) or (mode == "min" and v[1] < old) or mode == "sum":
            rec[field] = v[1]
            if mode != "sum":
                rec[field + "_t"] = when.strftime("%H:%M")

    put("temp_day_max", "tmax", "max")
    put("temp_day_min", "tmin", "min")
    put("wspdhi_day_max", "gmax", "max")
    put("bar_day_max", "pmax", "max")
    put("bar_day_min", "pmin", "min")
    put("hum_day_max", "hmax", "max")
    put("hum_day_min", "hmin", "min")
    put("rain_day_total", "rain", "sum")

    # stačí držet posledních ~400 dní
    keep = sorted(ds)[-400:]
    ds = {k: ds[k] for k in keep}
    os.makedirs(os.path.dirname(DAYSTATS), exist_ok=True)
    _write_json(DAYSTATS, ds)


# ---------------------------------------------------------------- přepočet souhrnů pro web
def _write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def _r1(v):
    return None if v is None else round(v, 1)


def build():
    rows = load_all()
    if not rows:
        print("Zatím žádná data.")
        return
    ds = {}
    if os.path.exists(DAYSTATS):
        with open(DAYSTATS, encoding="utf-8") as f:
            ds = json.load(f)

    # --- denní souhrny
    days = {}
    prev_r = None
    prev_day = None
    for r in rows:
        ldt = local_dt(r["ts"])
        day = ldt.strftime("%Y-%m-%d")
        d = days.get(day)
        if d is None:
            d = days[day] = {"d": day, "n": 0, "tsum": 0.0, "tn": 0, "hsum": 0.0, "hn": 0, "psum": 0.0, "pn": 0,
                             "dsum": 0.0, "dn": 0, "wsum": 0.0, "wn": 0, "rain": 0.0, "wr": [0] * 8, "calm": 0,
                             "tmin": None, "tmax": None, "tmin_t": None, "tmax_t": None, "gmax": None, "gmax_t": None,
                             "pmin": None, "pmax": None, "hmin": None, "hmax": None}
        d["n"] += 1
        hm = ldt.strftime("%H:%M")
        t = r["t"]
        if t is not None:
            d["tsum"] += t; d["tn"] += 1
            if d["tmax"] is None or t > d["tmax"]:
                d["tmax"], d["tmax_t"] = t, hm
            if d["tmin"] is None or t < d["tmin"]:
                d["tmin"], d["tmin_t"] = t, hm
        for key, s, n, lo, hi in (("h", "hsum", "hn", "hmin", "hmax"), ("p", "psum", "pn", "pmin", "pmax")):
            v = r[key]
            if v is not None:
                d[s] += v; d[n] += 1
                if d[lo] is None or v < d[lo]:
                    d[lo] = v
                if d[hi] is None or v > d[hi]:
                    d[hi] = v
        if r["dew"] is not None:
            d["dsum"] += r["dew"]; d["dn"] += 1
        if r["ws"] is not None:
            d["wsum"] += r["ws"]; d["wn"] += 1
            if r["ws"] < 0.5 or r["wd"] is None:
                d["calm"] += 1
            else:
                d["wr"][int(((r["wd"] % 360) + 22.5) // 45) % 8] += 1
        if r["wg"] is not None and (d["gmax"] is None or r["wg"] > d["gmax"]):
            d["gmax"], d["gmax_t"] = r["wg"], hm
        # srážky: čítač od místní půlnoci -> sčítáme přírůstky; nový den nebo pokles = vynulování
        rv = r["r"]
        if rv is not None:
            if prev_r is None or day != prev_day or rv < prev_r:
                inc = rv
            else:
                inc = rv - prev_r
            d["rain"] += inc
            prev_r = rv
            prev_day = day

    daily = []
    for day in sorted(days):
        d = days[day]
        extra = ds.get(day, {})
        tmax, tmin, tmax_t, tmin_t = d["tmax"], d["tmin"], d["tmax_t"], d["tmin_t"]
        if extra.get("tmax") is not None and (tmax is None or extra["tmax"] > tmax):
            tmax, tmax_t = extra["tmax"], extra.get("tmax_t", tmax_t)
        if extra.get("tmin") is not None and (tmin is None or extra["tmin"] < tmin):
            tmin, tmin_t = extra["tmin"], extra.get("tmin_t", tmin_t)
        gmax, gmax_t = d["gmax"], d["gmax_t"]
        if extra.get("gmax") is not None and (gmax is None or extra["gmax"] > gmax):
            gmax, gmax_t = extra["gmax"], extra.get("gmax_t", gmax_t)
        rain = d["rain"]
        # při řídkém měření (např. vypnuté PC) doplníme denní úhrn ze statistik Weathercloudu
        if d["n"] < 120 and extra.get("rain") is not None and extra["rain"] > rain:
            rain = extra["rain"]
        daily.append({
            "d": day, "n": d["n"],
            "tmin": _r1(tmin), "tmax": _r1(tmax), "tavg": _r1(d["tsum"] / d["tn"]) if d["tn"] else None,
            "tmin_t": tmin_t, "tmax_t": tmax_t,
            "havg": round(d["hsum"] / d["hn"]) if d["hn"] else None, "hmin": d["hmin"], "hmax": d["hmax"],
            "dew": _r1(d["dsum"] / d["dn"]) if d["dn"] else None,
            "pavg": _r1(d["psum"] / d["pn"]) if d["pn"] else None, "pmin": d["pmin"], "pmax": d["pmax"],
            "wavg": _r1(d["wsum"] / d["wn"]) if d["wn"] else None, "gmax": _r1(gmax), "gmax_t": gmax_t,
            "rain": _r1(rain), "wr": d["wr"], "calm": d["calm"],
        })

    # --- posledních N dní v plném rozlišení (sloupcově, ať je soubor malý)
    cutoff = rows[-1]["ts"] - RECENT_DAYS * 86400
    recent = {k: [] for k in FIELDS}
    for r in rows:
        if r["ts"] >= cutoff:
            for k in FIELDS:
                recent[k].append(r[k] if k == "ts" else _r1(r[k]))
    recent["tz"] = [prague_offset(rows[-1]["ts"])]

    os.makedirs(OUT_DIR, exist_ok=True)
    _write_json(os.path.join(OUT_DIR, "daily.json"), {"station": "Bulda", "days": daily})
    _write_json(os.path.join(OUT_DIR, "recent.json"), recent)
    print(f"Přepočteno: {len(daily)} dní, {len(recent['ts'])} měření za posledních {RECENT_DAYS} dní.")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--import"]:
        import_csv_dir(args[1] if len(args) > 1 else os.path.join(ROOT, "historie-csv"))
        build()
    elif args[:1] == ["--build"]:
        build()
    else:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
        try:
            row = collect_once()
            print(f"Staženo: {local_dt(row['ts']):%d.%m. %H:%M}  {row['t']} °C")
        except Exception as e:  # síť apod. – souhrny přepočítáme i tak
            print("Stažení se nepovedlo:", e)
        build()
        if "--no-forecast" not in args:
            sys.path.insert(0, ROOT)
            import forecast
            forecast.update()
