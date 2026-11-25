"""
Předpověď počasí pro Chýni.

Spojuje 10 meteorologických modelů (přes Open-Meteo.com) a každý z nich kalibruje
podle domácí stanice: změří, o kolik se v posledních týdnech mýlil, opraví jeho
systematickou chybu a modelům, které se trefují lépe, dá větší váhu.

  python forecast.py          aktualizuje předpověď (a kalibraci, je-li stará)
  python forecast.py --force  přepočítá vše hned
"""

import datetime as dt
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect  # noqa: E402

LAT, LON = 50.06, 14.22  # obec Chýně, zaokrouhleno
API = "https://api.open-meteo.com/v1/forecast"
API_PREV = "https://previous-runs-api.open-meteo.com/v1/forecast"
CALIB_FILE = os.path.join(collect.ROOT, "data", "calibration.json")
OUT_FILE = os.path.join(collect.OUT_DIR, "forecast.json")
FORECAST_MAX_AGE = 55 * 60
CALIB_MAX_AGE = 20 * 3600
CALIB_DAYS = 45  # z kolika posledních dní se počítá kalibrace
TEST_DAYS = 10   # posledních N dní slouží k poctivému změření přesnosti
FORECAST_DAYS = 10

MODELS = [
    {"id": "chmi_aladin_seamless", "name": "ALADIN", "src": "ČHMÚ · Česko", "hours": 72},
    {"id": "icon_seamless", "name": "ICON", "src": "DWD · Německo"},
    {"id": "ecmwf_ifs", "name": "IFS", "src": "ECMWF · Evropa"},
    {"id": "ecmwf_aifs025_single", "name": "AIFS", "src": "ECMWF · umělá inteligence"},
    {"id": "gfs_seamless", "name": "GFS", "src": "NOAA · USA"},
    {"id": "meteofrance_seamless", "name": "ARPEGE / AROME", "src": "Météo-France"},
    {"id": "ukmo_seamless", "name": "Unified Model", "src": "Met Office · Británie"},
    {"id": "knmi_harmonie_arome_europe", "name": "HARMONIE", "src": "KNMI · Nizozemsko"},
    {"id": "dmi_harmonie_arome_europe", "name": "HARMONIE", "src": "DMI · Dánsko"},
    {"id": "gem_seamless", "name": "GEM", "src": "Kanada"},
]
IDS = [m["id"] for m in MODELS]


# ---------------------------------------------------------------- pomocné
def get_json(base, params, tries=3):
    url = base + "?" + urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "meteo-dashboard (non-commercial)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # síť, 429…
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"Open-Meteo nedostupné: {last}")


def iso_ts(s):
    return int(dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp())


def series(hourly, var, model):
    return hourly.get(f"{var}_{model}") or [None] * len(hourly["time"])


def wmean(pairs):
    sw = sum(w for _, w in pairs)
    return sum(v * w for v, w in pairs) / sw if sw else None


def r1(v):
    return None if v is None else round(v, 1)


def load_json(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


# ---------------------------------------------------------------- měření stanice po hodinách
def station_hours(since):
    rows = [r for r in collect.load_all() if r["ts"] >= since - 3600]
    best, gust = {}, {}
    for r in rows:
        h = int(round(r["ts"] / 3600) * 3600)
        d = abs(r["ts"] - h)
        if d <= 600 and r["t"] is not None and (h not in best or d < best[h][0]):
            best[h] = (d, r)
        if r["wg"] is not None:
            H = int(math.ceil(r["ts"] / 3600) * 3600)  # nárazy: maximum za předchozí hodinu
            gust[H] = max(gust.get(H, 0.0), r["wg"])
    return {h: {"t": r["t"], "ws": r["ws"], "wg": gust.get(h)} for h, (_, r) in best.items()}


# ---------------------------------------------------------------- kalibrace
def _fit(points, lam=5.0):
    """Chyba = a + b·x (x = sluneční záření / 500 W/m²), s mírným tlumením b."""
    n = len(points)
    if n < 24:
        return 0.0, 0.0
    sx = sum(x for x, _ in points)
    sxx = sum(x * x for x, _ in points) + lam
    se = sum(e for _, e in points)
    sxe = sum(x * e for x, e in points)
    det = n * sxx - sx * sx
    if abs(det) < 1e-9:
        return se / n, 0.0
    a = (se * sxx - sx * sxe) / det
    b = (n * sxe - sx * se) / det
    return a, b


def calibrate():
    now = int(time.time())
    vars_ = ["temperature_2m_previous_day1", "temperature_2m_previous_day2", "temperature_2m_previous_day3",
             "shortwave_radiation_previous_day1", "shortwave_radiation_previous_day2", "shortwave_radiation_previous_day3",
             "wind_speed_10m_previous_day1", "wind_gusts_10m_previous_day1"]
    js = get_json(API_PREV, {"latitude": LAT, "longitude": LON, "hourly": ",".join(vars_), "models": ",".join(IDS),
                             "past_days": CALIB_DAYS + 1, "forecast_days": 1, "timezone": "GMT"})
    h = js["hourly"]
    times = [iso_ts(s) for s in h["time"]]
    st = station_hours(times[0])
    split = now - TEST_DAYS * 86400

    out = {}
    for m in IDS:
        rec = {}
        lead = {}
        for d in (1, 2, 3):
            T = series(h, f"temperature_2m_previous_day{d}", m)
            R = series(h, f"shortwave_radiation_previous_day{d}", m)
            pts = []
            for i, ts in enumerate(times):
                s = st.get(ts)
                if ts >= now or s is None or T[i] is None:
                    continue
                pts.append((ts, (R[i] or 0.0) / 500.0, T[i], s["t"]))
            lead[d] = pts
        p1 = lead[1]
        if len(p1) < 48:
            continue  # model nemá dost dat
        train = [p for p in p1 if p[0] < split] or p1
        a, b = _fit([(x, obs - mod) for _, x, mod, obs in train])

        def mae(pts, a=a, b=b, raw=False):
            test = [p for p in pts if p[0] >= split]
            if len(test) < 24:
                return None
            return sum(abs(obs - (mod if raw else mod + a + b * x)) for _, x, mod, obs in test) / len(test)

        rec["mae_raw1"] = mae(p1, raw=True)
        rec["mae1"], rec["mae2"], rec["mae3"] = mae(lead[1]), mae(lead[2]), mae(lead[3])
        if rec["mae1"] is not None and rec["mae_raw1"] is not None and rec["mae1"] > rec["mae_raw1"]:
            # oprava na testovacích dnech nepomohla -> model necháme bez opravy
            rec["a"], rec["b"] = 0.0, 0.0
            rec["mae1"], rec["mae2"], rec["mae3"] = (mae(lead[d], raw=True) for d in (1, 2, 3))
            rec["corrected"] = False
        else:
            # konečná oprava ze všech dní
            rec["a"], rec["b"] = _fit([(x, obs - mod) for _, x, mod, obs in p1])
            rec["corrected"] = True
        rec["n"] = len(p1)

        # vítr: stanice stojí v závětří -> poměr mezi měřením a modelem
        W = series(h, "wind_speed_10m_previous_day1", m)
        G = series(h, "wind_gusts_10m_previous_day1", m)
        sw = sm = sg = smg = 0.0
        for i, ts in enumerate(times):
            s = st.get(ts)
            if s is None or ts >= now:
                continue
            if W[i] is not None and s["ws"] is not None:
                sw += s["ws"]; sm += W[i]
            if G[i] is not None and s["wg"] is not None:
                sg += s["wg"]; smg += G[i]
        rec["k_ws"] = min(1.5, max(0.1, sw / sm)) if sm > 50 else None
        rec["k_wg"] = min(1.5, max(0.1, sg / smg)) if smg > 50 else None
        out[m] = rec

    # modelům bez dat o větru dáme typický přepočet ostatních
    for key in ("k_ws", "k_wg"):
        ks = sorted(r[key] for r in out.values() if r[key] is not None)
        med = ks[len(ks) // 2] if ks else 1.0
        for r in out.values():
            if r[key] is None:
                r[key] = med

    # jak by si vedla kombinovaná předpověď (na testovacích dnech, předpověď na zítřek)
    weights = {m: 1 / max(0.3, r["mae1"]) ** 2 for m, r in out.items() if r.get("mae1")}
    T1 = {m: series(h, "temperature_2m_previous_day1", m) for m in out}
    R1 = {m: series(h, "shortwave_radiation_previous_day1", m) for m in out}
    err_blend, err_raw = [], []
    for i, ts in enumerate(times):
        s = st.get(ts)
        if s is None or ts < split or ts >= now:
            continue
        pairs, raw = [], []
        for m, w in weights.items():
            t = T1[m][i]
            if t is None:
                continue
            r = out[m]
            pairs.append((t + r["a"] + r["b"] * (R1[m][i] or 0) / 500.0, w))
            raw.append(t)
        if len(pairs) >= 3:
            err_blend.append(abs(s["t"] - wmean(pairs)))
            err_raw.append(abs(s["t"] - sum(raw) / len(raw)))

    calib = {
        "updated": now, "days": CALIB_DAYS, "test_days": TEST_DAYS, "models": out,
        "blend_mae1": sum(err_blend) / len(err_blend) if err_blend else None,
        "raw_mean_mae1": sum(err_raw) / len(err_raw) if err_raw else None,
    }
    save_json(CALIB_FILE, calib)
    return calib


# ---------------------------------------------------------------- texty
DOW_LOC = ["v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu", "v neděli"]
DOW_NAME = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"]
DIR8_FROM = ["od severu", "od severovýchodu", "od východu", "od jihovýchodu", "od jihu", "od jihozápadu", "od západu", "od severozápadu"]
SYM_WORD = {"clear": "jasno", "mostly_clear": "skoro jasno", "partly": "polojasno", "cloudy": "oblačno", "overcast": "zataženo",
            "fog": "mlhavo", "rain": "déšť", "showers": "přeháňky", "snow": "sněžení", "sleet": "déšť se sněhem", "storm": "bouřky"}


def fmt(v, d=0):
    s = f"{v:.{d}f}".replace(".", ",")
    if s.startswith("-"):
        s = "−" + s[1:]
    if s in ("−0", "−0,0"):
        s = s[1:]
    return s


def beaufort(k):
    lim = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]
    names = ["bezvětří", "vánek", "větřík", "slabý vítr", "mírný vítr", "čerstvý vítr", "silný vítr", "prudký vítr",
             "bouřlivý vítr", "vichřice", "silná vichřice", "mohutná vichřice", "orkán"]
    i = 0
    while i < len(lim) and k >= lim[i]:
        i += 1
    return names[i]


def sky_word(c):
    return "jasno" if c < 15 else "skoro jasno" if c < 35 else "polojasno" if c < 62 else "oblačno" if c < 87 else "zataženo"


def part_of_day(h):
    return "ráno" if 5 <= h < 9 else "dopoledne" if 9 <= h < 12 else "odpoledne" if 12 <= h < 17 else "večer" if 17 <= h < 22 else "v noci"


def dir_index(deg):
    return int(((deg % 360) + 22.5) // 45) % 8


def precip_phrase(H):
    """H: seznam hodin (dicty) – vrací větu o srážkách."""
    if not H:
        return ""
    pmax = max(x["prob"] for x in H)
    total = sum(x["rain"] for x in H)
    storm = max(x["storm"] for x in H) >= 0.3
    wet = [x for x in H if x["prob"] >= 0.45 and x["rain"] >= 0.05] or [x for x in H if x["prob"] >= 0.3]
    snowy = sum(1 for x in wet if x["t"] <= 0.8) / len(wet) if wet else 0
    kind = "sněžit" if snowy > 0.7 else "padat déšť se sněhem" if snowy > 0.3 else "pršet"
    if pmax < 0.15 and total < 0.2:
        return "Bez srážek."
    if pmax < 0.35:
        return "Srážky jsou málo pravděpodobné."
    parts = []
    for x in wet:
        p = part_of_day(x["lh"])
        if p not in parts:
            parts.append(p)
    when = " a ".join(parts[:2]) if len(parts) <= 2 else "během dne"
    if snowy > 0.7:
        amount = f", asi {fmt(max(1, round(total)))} cm sněhu" if total >= 0.5 else ""
    else:
        amount = f", asi {fmt(total, 1 if total < 10 else 0)} mm" if total >= 0.5 else ""
    if pmax < 0.6:
        s = f"Občas může {kind}{(' ' + when) if when and len(parts) <= 2 else ''}{amount}."
    else:
        s = f"Bude {kind}{(' hlavně ' + when) if len(parts) <= 2 else ''}{amount}."
    if storm:
        s += " Možné jsou i bouřky."
    if any(x["prob"] >= 0.35 and -3 <= x["t"] <= 0.5 for x in H) and snowy < 0.7:
        s += " Pozor na náledí."
    return s


def describe(label, H, spread):
    """Odstavec pro jedno období (dnes, zítra…)."""
    if not H:
        return None
    sent = []
    cloud = sum(x["cloud"] for x in H if 8 <= x["lh"] < 18) / max(1, sum(1 for x in H if 8 <= x["lh"] < 18)) \
        if any(8 <= x["lh"] < 18 for x in H) else sum(x["cloud"] for x in H) / len(H)
    fog = sum(1 for x in H if x["fog"] >= 0.4)
    sky = sky_word(cloud)
    night_only = all(x["lh"] >= 18 or x["lh"] < 7 for x in H)
    sent.append(f"{sky[0].upper() + sky[1:]}{', místy mlha' if fog >= 3 else ''}.")
    early = [x for x in H if x["lh"] < 9]
    day = [x for x in H if 11 <= x["lh"] < 17]
    if night_only:
        tmin = min(x["t"] for x in H)
        sent.append(f"Teplota v noci klesne na {fmt(tmin)} °C." if tmin < 0.5 else f"V noci kolem {fmt(tmin)} °C.")
    else:
        bits = []
        if early:
            tm = min(x["t"] for x in early)
            bits.append(f"ráno {'mráz ' if tm < -0.5 else ''}{fmt(tm)} °C")
        if day:
            bits.append(f"odpoledne {'až ' if max(x['t'] for x in day) > 0 else ''}{fmt(max(x['t'] for x in day))} °C")
        if not bits:
            bits.append(f"kolem {fmt(sum(x['t'] for x in H) / len(H))} °C")
        txt = ", ".join(bits)
        sent.append(txt[0].upper() + txt[1:] + ".")
    sent.append(precip_phrase(H))
    ws = max(x["ws"] for x in H)
    g_raw = max(x["wg_raw"] for x in H)
    dirs = [x["wd"] for x in H if x["wd"] is not None]
    if dirs:
        sx = sum(math.sin(math.radians(d)) for d in dirs); cx = sum(math.cos(math.radians(d)) for d in dirs)
        dname = DIR8_FROM[dir_index(math.degrees(math.atan2(sx, cx)))]
    else:
        dname = ""
    wtxt = beaufort(ws)
    sent.append(f"{wtxt[0].upper() + wtxt[1:]}{(' ' + dname) if dname and ws >= 1 else ''}."
                + (f" Na otevřených místech nárazy až {fmt(g_raw)} km/h." if g_raw >= 45 else ""))
    if spread is not None and spread >= 4:
        sent.append(f"Předpověď je zatím nejistá – modely se liší až o {fmt(spread)} °C.")
    return " ".join(s for s in sent if s)


# ---------------------------------------------------------------- předpověď
def build_forecast(calib):
    now = int(time.time())
    fv = ["temperature_2m", "precipitation", "precipitation_probability", "weather_code", "cloud_cover", "wind_speed_10m",
          "wind_gusts_10m", "wind_direction_10m", "shortwave_radiation", "snowfall"]
    js = get_json(API, {"latitude": LAT, "longitude": LON, "hourly": ",".join(fv), "models": ",".join(IDS),
                        "forecast_days": FORECAST_DAYS, "timezone": "GMT"})
    h = js["hourly"]
    times = [iso_ts(s) for s in h["time"]]
    cm = calib.get("models", {}) if calib else {}
    start = now - 3600
    hours = []
    per_model_t = {m: {} for m in IDS}
    for i, ts in enumerate(times):
        if ts < start:
            continue
        lead = (ts - now) / 3600
        tp, rn, pr_ens, cl, ws, wg, wgr, wdx, wdy, storm, fog = [], [], [], [], [], [], [], 0.0, 0.0, [], []
        for mdef in MODELS:
            m = mdef["id"]
            if mdef.get("hours") and lead > mdef["hours"]:
                continue
            t = series(h, "temperature_2m", m)[i]
            if t is None:
                continue
            c = cm.get(m, {})
            mae = c.get("mae1") if lead < 48 else (c.get("mae2") or (c.get("mae1") or 2) * 1.2) if lead < 72 \
                else (c.get("mae3") or c.get("mae2") or (c.get("mae1") or 2) * 1.4)
            w = 1 / max(0.3, mae or 2.5) ** 2
            rad = series(h, "shortwave_radiation", m)[i] or 0.0
            tc = t + c.get("a", 0.0) + c.get("b", 0.0) * rad / 500.0
            per_model_t[m][ts] = tc
            tp.append((tc, w))
            p = series(h, "precipitation", m)[i]
            if p is not None:
                rn.append((p, w))
            pp = series(h, "precipitation_probability", m)[i]
            if pp is not None:
                pr_ens.append(pp / 100)
            cc = series(h, "cloud_cover", m)[i]
            if cc is not None:
                cl.append((cc, w))
            v = series(h, "wind_speed_10m", m)[i]
            if v is not None:
                ws.append((v * c.get("k_ws", 1.0), w))
                d = series(h, "wind_direction_10m", m)[i]
                if d is not None:
                    wdx += w * v * math.sin(math.radians(d)); wdy += w * v * math.cos(math.radians(d))
            g = series(h, "wind_gusts_10m", m)[i]
            if g is not None:
                wg.append((g * c.get("k_wg", 1.0), w)); wgr.append((g, w))
            code = series(h, "weather_code", m)[i]
            if code is not None:
                storm.append((1.0 if code >= 95 else 0.0, w))
                fog.append((1.0 if code in (45, 48) else 0.0, w))
        if len(tp) < 2:
            continue
        sw_rn = sum(w for _, w in rn)
        p_models = sum(w for p, w in rn if p >= 0.1) / sw_rn if sw_rn else 0
        p_ens = sum(pr_ens) / len(pr_ens) if pr_ens else None
        prob = p_models if p_ens is None else 0.5 * p_models + 0.5 * p_ens
        lt = collect.local_dt(ts)
        hours.append({
            "ts": ts, "lh": lt.hour, "day": lt.strftime("%Y-%m-%d"), "n": len(tp),
            "t": wmean(tp), "tlo": min(v for v, _ in tp), "thi": max(v for v, _ in tp),
            "rain": wmean(rn) or 0.0, "prob": prob, "cloud": wmean(cl) or 0.0,
            "ws": wmean(ws) or 0.0, "wg": wmean(wg) or 0.0, "wg_raw": wmean(wgr) or 0.0,
            "wd": (math.degrees(math.atan2(wdx, wdy)) % 360) if (wdx or wdy) else None,
            "storm": wmean(storm) or 0.0, "fog": wmean(fog) or 0.0,
        })

    # ---- dny
    days = []
    by_day = {}
    for x in hours:
        by_day.setdefault(x["day"], []).append(x)
    for d, H in by_day.items():
        if len(H) < 3:
            continue
        mx = {}
        for m, tser in per_model_t.items():
            vals = [tser[x["ts"]] for x in H if x["ts"] in tser]
            if len(vals) >= 0.8 * len(H):
                mx[m] = (max(vals), min(vals))
        daytime = [x for x in H if 8 <= x["lh"] < 18] or H
        rain = sum(x["rain"] for x in H)
        # pravděpodobnost srážek za den: podíl modelů, které dávají aspoň 0,5 mm, + ansámbly
        idx = [times.index(x["ts"]) for x in H]
        hit = tot = 0.0
        for mdef in MODELS:
            m = mdef["id"]
            P = series(h, "precipitation", m)
            vals = [P[i] for i in idx if P[i] is not None]
            if len(vals) < 0.8 * len(H) or (mdef.get("hours") and (H[-1]["ts"] - now) / 3600 > mdef["hours"]):
                continue
            c = cm.get(m, {})
            w = 1 / max(0.3, c.get("mae1") or 2.5) ** 2
            tot += w
            if sum(vals) >= 0.5:
                hit += w
        ens = max(x["prob"] for x in H)
        prob = (0.5 * hit / tot + 0.5 * ens) if tot else ens
        snow_share = (sum(x["rain"] for x in H if x["t"] <= 0.8) / rain) if rain > 0.1 else 0
        storm = max(x["storm"] for x in H) >= 0.3
        cloud = sum(x["cloud"] for x in daytime) / len(daytime)
        fogh = sum(1 for x in H if x["fog"] >= 0.4 and x["lh"] < 12)
        if storm and prob >= 0.35:
            sym = "storm"
        elif prob >= 0.5 and rain >= 0.5:
            sym = "snow" if snow_share > 0.7 else "sleet" if snow_share > 0.3 else ("showers" if cloud < 70 else "rain")
        elif fogh >= 4 and cloud > 50:
            sym = "fog"
        else:
            sym = "clear" if cloud < 15 else "mostly_clear" if cloud < 35 else "partly" if cloud < 62 else "cloudy" if cloud < 87 else "overcast"
        dx = sum(x["ws"] * math.sin(math.radians(x["wd"])) for x in daytime if x["wd"] is not None)
        dy = sum(x["ws"] * math.cos(math.radians(x["wd"])) for x in daytime if x["wd"] is not None)
        days.append({
            "d": d, "tmax": r1(max(x["t"] for x in H)), "tmin": r1(min(x["t"] for x in H)),
            "tmax_lo": r1(min(v[0] for v in mx.values())) if mx else None, "tmax_hi": r1(max(v[0] for v in mx.values())) if mx else None,
            "tmin_lo": r1(min(v[1] for v in mx.values())) if mx else None, "tmin_hi": r1(max(v[1] for v in mx.values())) if mx else None,
            "rain": r1(rain), "prob": round(prob * 100), "sym": sym, "cloud": round(cloud),
            "ws": r1(max(x["ws"] for x in daytime)), "wg": r1(max(x["wg"] for x in H)), "wg_raw": r1(max(x["wg_raw"] for x in H)),
            "wd": round(math.degrees(math.atan2(dx, dy)) % 360) if (dx or dy) else None,
            "models": len(mx), "partial": len(H) < 20,
        })

    # ---- texty
    texts = []
    lnow = collect.local_dt(now)
    today = lnow.strftime("%Y-%m-%d")
    tomorrow = (lnow + dt.timedelta(days=1)).strftime("%Y-%m-%d")
    after = (lnow + dt.timedelta(days=2)).strftime("%Y-%m-%d")
    spread = {d["d"]: (d["tmax_hi"] - d["tmax_lo"]) if d["tmax_hi"] is not None else None for d in days}
    rest = [x for x in hours if x["day"] == today and x["ts"] >= now - 1800]
    if lnow.hour < 12:
        lbl, H = "Dnes", rest
    elif lnow.hour < 18:
        lbl, H = "Dnes odpoledne a večer", rest
    else:
        H = [x for x in hours if x["ts"] >= now - 1800 and (x["day"] == today or (x["day"] == tomorrow and x["lh"] < 7))]
        lbl = "Dnes v noci"
    t = describe(lbl, H, None)
    if t:
        texts.append({"title": lbl, "text": t})
    for d, word in ((tomorrow, "Zítra"), (after, None)):
        H = [x for x in hours if x["day"] == d]
        if len(H) >= 20:
            name = word or DOW_NAME[dt.date.fromisoformat(d).weekday()]
            texts.append({"title": name, "text": describe(name, H, spread.get(d))})
    later = [d for d in days if d["d"] > after]
    if later:
        texts.append({"title": "Výhled", "text": outlook(later, days)})

    out = {
        "generated": now, "source": "Open-Meteo.com",
        "calibrated": int(calib["updated"]) if calib else None,
        "blend_mae1": r1(calib.get("blend_mae1")) if calib else None,
        "raw_mean_mae1": r1(calib.get("raw_mean_mae1")) if calib else None,
        "calib_days": CALIB_DAYS, "test_days": TEST_DAYS,
        "models": sorted([
            {"id": m["id"], "name": m["name"], "src": m["src"],
             "mae1": r1(cm.get(m["id"], {}).get("mae1")), "mae_raw1": r1(cm.get(m["id"], {}).get("mae_raw1")),
             "horizon": m.get("hours")}
            for m in MODELS], key=lambda r: (r["mae1"] is None, r["mae1"] or 0)),
        "texts": texts,
        "hourly": {k: [r1(x[k]) if isinstance(x[k], float) else x[k] for x in hours]
                   for k in ("ts", "t", "tlo", "thi", "rain", "cloud", "ws", "wg", "wd")},
        "daily": days,
    }
    out["hourly"]["prob"] = [round(x["prob"] * 100) for x in hours]
    weights = {m["id"]: 1 / max(0.3, cm[m["id"]]["mae1"]) ** 2 for m in MODELS if cm.get(m["id"], {}).get("mae1")}
    sw = sum(weights.values())
    for r in out["models"]:
        r["weight"] = round(100 * weights[r["id"]] / sw) if r["id"] in weights and sw else None
    save_json(OUT_FILE, out)
    return out


def outlook(later, days):
    s = []
    first, last = later[: len(later) // 2 or 1], later[len(later) // 2:] or later
    a = sum(d["tmax"] for d in first) / len(first)
    b = sum(d["tmax"] for d in last) / len(last)
    if b - a >= 3:
        s.append("Ke konci období se oteplí")
    elif a - b >= 3:
        s.append("Ke konci období se ochladí")
    else:
        s.append("Teploty bez velkých změn")
    s[-1] += f", přes den {fmt(min(d['tmax'] for d in later))} až {fmt(max(d['tmax'] for d in later))} °C."
    frost = [d for d in later if d["tmin"] is not None and d["tmin"] < 0]
    if frost:
        s.append("Ranní mrazy " + ("skoro každý den." if len(frost) >= len(later) - 1 else f"{len(frost)}× za těch {len(later)} dní."))
    wet = [d for d in later if d["prob"] >= 50]
    if wet:
        names = [DOW_LOC[dt.date.fromisoformat(d["d"]).weekday()] for d in wet[:3]]
        kind = "sníh" if all(d["sym"] == "snow" for d in wet) else "srážky"
        s.append(f"{kind[0].upper() + kind[1:]} nejspíš {', '.join(names[:-1]) + ' a ' + names[-1] if len(names) > 1 else names[0]}.")
    else:
        s.append("Výraznější srážky zatím nevypadají pravděpodobně.")
    s.append("Čím dál dopředu, tím je předpověď méně jistá.")
    return " ".join(s)


def update(force=False):
    """Zavolá se z collect.py / server.py: aktualizuje jen to, co je staré."""
    now = time.time()
    calib = load_json(CALIB_FILE)
    if force or not calib or now - calib.get("updated", 0) > CALIB_MAX_AGE:
        try:
            calib = calibrate()
            print("Kalibrace modelů hotová.")
        except Exception as e:
            print("Kalibrace se nepovedla:", e)
    fc = load_json(OUT_FILE)
    if force or not fc or now - fc.get("generated", 0) > FORECAST_MAX_AGE:
        try:
            build_forecast(calib)
            print("Předpověď aktualizována.")
        except Exception as e:
            print("Předpověď se nepovedla:", e)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    update(force="--force" in sys.argv)
