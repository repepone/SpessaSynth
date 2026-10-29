"""Genera los MIDI de prueba del laboratorio.

Uso:  python -I make_midis.py <directorio_salida>
Requiere music21 (pip install music21), que incluye las partituras del corpus.

- orquestal_bach_bwv248_64.mid : J. S. Bach, Oratorio de Navidad BWV 248, nº 64 (coral final):
  3 trompetas, timbal, 2 oboes, cuerda, coro SATB y continuo. Corpus de music21.
- camara_beethoven_op18n1_i.mid : L. v. Beethoven, Cuarteto op. 18 nº 1, 1er mov. Corpus de music21.
- estres_tutti_sintetico.mid : NO es música; 15 canales con acordes repetidos para buscar el techo de CPU.
- temporizado_clicks.mid : clics de wood block (canal 10) en ticks conocidos, con cambio de tempo
  en mitad, para medir la precisión del secuenciador.
- metronomo_120.mid : un clic cada 0,5 s durante 60 s, para la prueba de sincronía en tiempo real.
Los programas GM se asignan aquí a mano: el mapeo automático de music21 para el Bach es erróneo
(asigna guitarra a las trompetas y oboe a la soprano).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smf import write_smf, tempo_event, name_event  # noqa: E402

PPQ = 480


def score_to_tracks(score, plan, bpm):
    """plan: lista de (nombre_parte, canal, programa, pan, transposición_octavas, nombre_pista)."""
    parts = {p.partName: p for p in score.parts}
    tracks = [[(0, tempo_event(bpm)), (0, name_event("tempo"))]]
    notes_total = 0
    for part_name, ch, prog, pan, octv, label in plan:
        p = parts[part_name].stripTies()
        ev = [(0, name_event(label)), (0, bytes([0xC0 | ch, prog])),
              (0, bytes([0xB0 | ch, 10, pan])), (0, bytes([0xB0 | ch, 7, 100]))]
        for n in p.recurse().notes:
            on = round(float(n.getOffsetInHierarchy(p)) * PPQ)
            dur = max(1, round(float(n.duration.quarterLength) * PPQ))
            pitches = n.pitches
            for pt in pitches:
                key = pt.midi + 12 * octv
                if not 0 <= key <= 127:
                    continue
                ev.append((on, bytes([0x90 | ch, key, 80])))
                ev.append((on + dur - 1, bytes([0x80 | ch, key, 0])))
                notes_total += 1
        tracks.append(ev)
    return tracks, notes_total


def main(out):
    from music21 import corpus
    os.makedirs(out, exist_ok=True)
    info = {}

    # Orquestal: Bach BWV 248/64 (canal 9 = percusión GM, se evita)
    bach = corpus.parse("bach/bwv248.64-6.mxl")
    plan = [
        ("Trumpet 1", 0, 56, 40, 0, "Tromba 1"), ("Trumpet 2", 1, 56, 48, 0, "Tromba 2"),
        ("Trumpet 3", 2, 56, 56, 0, "Tromba 3"), ("Timpani", 3, 47, 64, 0, "Timpani"),
        ("Oboe 1", 4, 68, 72, 0, "Oboe 1"), ("Oboe 2", 5, 68, 80, 0, "Oboe 2"),
        ("Violin 1", 6, 40, 30, 0, "Violino 1"), ("Violin 2", 7, 40, 50, 0, "Violino 2"),
        ("Viola", 8, 41, 74, 0, "Viola"), ("Soprano", 10, 52, 54, 0, "Soprano"),
        ("Alto", 11, 52, 60, 0, "Alto"), ("Tenor", 12, 52, 68, 0, "Tenore"),
        ("Bass", 13, 52, 74, 0, "Basso"), ("Continuo", 14, 42, 90, 0, "Continuo (vc)"),
        ("Continuo", 15, 43, 96, -1, "Continuo (cb 8va bassa)"),
    ]
    tracks, n = score_to_tracks(bach, plan, 80)
    write_smf(os.path.join(out, "orquestal_bach_bwv248_64.mid"), PPQ, tracks)
    info["orquestal_bach_bwv248_64.mid"] = {"fuente": "music21 corpus bach/bwv248.64-6.mxl", "negra_bpm": 80,
                                             "canales": len(plan), "notas": n,
                                             "negras": float(bach.highestTime)}

    # Cámara: Beethoven op. 18 nº 1, I
    beet = corpus.parse("beethoven/opus18no1/movement1.mxl")
    plan = [("Violin I", 0, 40, 40, 0, "Violino I"), ("Violin II", 1, 40, 56, 0, "Violino II"),
            ("Viola", 2, 41, 72, 0, "Viola"), ("Cello", 3, 42, 88, 0, "Violoncello")]
    tracks, n = score_to_tracks(beet, plan, 168)
    write_smf(os.path.join(out, "camara_beethoven_op18n1_i.mid"), PPQ, tracks)
    info["camara_beethoven_op18n1_i.mid"] = {"fuente": "music21 corpus beethoven/opus18no1/movement1.mxl",
                                              "negra_bpm": 168, "canales": 4, "notas": n,
                                              "negras": float(beet.highestTime)}

    # Estrés sintético: 15 canales, acorde de 4 notas cada corchea durante 60 s a negra=120
    progs = [40, 40, 41, 42, 43, 73, 68, 71, 70, 56, 60, 57, 58, 47, 52]
    chans = [c for c in range(16) if c != 9]
    tracks = [[(0, tempo_event(120)), (0, name_event("tempo"))]]
    n = 0
    eighth = PPQ // 2
    chord = [0, 4, 7, 12]
    for prog, ch in zip(progs, chans):
        base = 36 + (ch * 3) % 36
        ev = [(0, name_event(f"estres prog {prog}")), (0, bytes([0xC0 | ch, prog]))]
        for i in range(240):  # 240 corcheas = 60 s a negra 120
            t = i * eighth
            for iv in chord:
                ev.append((t, bytes([0x90 | ch, base + iv, 70 + (i % 4) * 10])))
                ev.append((t + PPQ * 2 - 1, bytes([0x80 | ch, base + iv, 0])))  # se solapan: 4 notas x 4 corcheas
                n += 1
        tracks.append(ev)
    write_smf(os.path.join(out, "estres_tutti_sintetico.mid"), PPQ, tracks)
    info["estres_tutti_sintetico.mid"] = {"fuente": "sintético (este script)", "negra_bpm": 120,
                                          "canales": 15, "notas": n, "negras": 120.0}

    # Temporizado: 40 clics a negra=120, cambio a negra=90 en el clic 20; clics cada 7/16 de negra
    # (no múltiplo de 128 muestras), wood block agudo (nota 76) en canal 10.
    step = PPQ * 7 // 16  # 210 ticks
    clicks = [i * step for i in range(40)]
    change_tick = clicks[20]
    t0 = [(0, tempo_event(120)), (0, name_event("tempo")), (change_tick, tempo_event(90))]
    # Envíos de reverb (CC91) y chorus (CC93) a 0 para que la cola no tape los ataques
    ev = [(0, name_event("clicks")), (0, bytes([0xB9, 91, 0])), (0, bytes([0xB9, 93, 0]))]
    for t in clicks:
        ev.append((t, bytes([0x99, 76, 127])))
        ev.append((t + 30, bytes([0x89, 76, 0])))
    write_smf(os.path.join(out, "temporizado_clicks.mid"), PPQ, [t0, ev])
    # Tiempo ideal de cada clic en segundos
    ideal = []
    for t in clicks:
        if t <= change_tick:
            ideal.append(t / PPQ * 0.5)
        else:
            ideal.append(change_tick / PPQ * 0.5 + (t - change_tick) / PPQ * (60 / 90))
    info["temporizado_clicks.mid"] = {"fuente": "sintético (este script)", "ppq": PPQ, "ticks": clicks,
                                      "tiempos_ideales_s": ideal, "cambio_tempo_tick": change_tick}

    # Metrónomo para la prueba de sincronía en tiempo real: 1 clic por negra a 120 (cada 0,5 s), 60 s
    t0 = [(0, tempo_event(120)), (0, name_event("tempo"))]
    ev = [(0, name_event("metronomo")), (0, bytes([0xB9, 91, 0])), (0, bytes([0xB9, 93, 0]))]
    for i in range(120):
        ev.append((i * PPQ, bytes([0x99, 76, 127])))
        ev.append((i * PPQ + 30, bytes([0x89, 76, 0])))
    write_smf(os.path.join(out, "metronomo_120.mid"), PPQ, [t0, ev])
    info["metronomo_120.mid"] = {"fuente": "sintético (este script)", "negra_bpm": 120, "clics": 120,
                                 "periodo_s": 0.5}

    with open(os.path.join(out, "midis.json"), "w") as f:
        json.dump(info, f, indent=1, ensure_ascii=False)
    for k, v in info.items():
        print(k, {kk: vv for kk, vv in v.items() if kk not in ("ticks", "tiempos_ideales_s")})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "midi")
