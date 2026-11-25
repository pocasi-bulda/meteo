# Počasí u nás – meteostanice Bulda (Chýně)

Samostatná webová apka s daty z domácí meteostanice (CCL W100 → Weathercloud).
Nemá nic společného s jiným webem, všechno je v této složce.

## Online (GitHub)

Apka běží sama na GitHubu – PC nemusí být zapnuté. Každých 15 minut
(`.github/workflows/update.yml`) GitHub stáhne data ze stanice, přepočítá
předpověď, uloží nová měření do `data/` a zveřejní web přes GitHub Pages.
Ruční spuštění: na GitHubu záložka **Actions → Aktualizace počasí → Run workflow**.

## Předpověď (`forecast.py`)

Kombinuje 10 modelů přes Open-Meteo.com: ČHMÚ ALADIN, DWD ICON, ECMWF IFS
a AIFS, NOAA GFS, Météo-France, UK Met Office, KNMI a DMI HARMONIE, kanadský GEM.
Jednou denně se každý model porovná s měřením stanice za posledních 45 dní:
opraví se jeho typická chyba (i podle slunce – čidlo na slunci ukazuje víc)
a přesnější modely dostanou větší váhu. Vítr se přepočítá na kryté místo stanice.
Přesnost se poctivě měří na posledních 10 dnech, které se do opravy nepočítají.

## Lokálně na PC (nepovinné)

Dvojklik na **`Spustit meteo.bat`**. Otevře se okno se serverem a v prohlížeči apka.

- Na tomto PC: http://localhost:8765
- Na mobilu/tabletu ve stejné Wi-Fi: adresa typu `http://192.168.x.x:8765`
  (přesnou vypíše okno serveru). Při prvním spuštění se Windows může zeptat
  na povolení Pythonu v síti – povolit pro **soukromé sítě**.

Dokud okno běží, každých 10 minut se stáhnou nová data. Zavřením okna se apka vypne.
Když PC neběží, data se nesbírají – denní maxima, minima a srážky se ale
po zapnutí doplní ze statistik Weathercloudu.

## Co apka ukazuje

- **Právě teď** – teplota, trend za hodinu, pocitová teplota, dnešní min/max,
  vítr se směrem, tlak a jeho tendence za 3 h, vlhkost, rosný bod, srážky.
- **Průběh** – grafy za 24 hodin / 7 dní / 30 dní (teplota, srážky, vítr, tlak, vlhkost).
- **Posledních 12 měsíců** – počty mrazových, letních, tropických dní…, rekordy,
  teplota den po dni, kalendář, srážky po měsících, větrná růžice, měsíční tabulka
  a tabulka všech dní.

## Soubory

| Co | Kde |
|---|---|
| Stahování a přepočet dat | `collect.py` |
| Server pro web | `server.py` |
| Webová stránka | `web/` |
| Všechna měření (po měsících) | `data/raw/*.csv` |
| Původní exporty z Weathercloudu | `historie-csv/` |

## Ruční příkazy

```
python collect.py                      # jedno stažení + přepočet
python collect.py --build              # jen přepočet
python collect.py --import historie-csv  # znovu načíst exporty z Weathercloudu
```

Starší historii (před 12/2025) Weathercloud zdarma nedává – export je omezený
na posledních 12 měsíců. Nové exporty stačí uložit do `historie-csv/`
a spustit import.
