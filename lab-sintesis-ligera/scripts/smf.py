"""Escritor mínimo de Standard MIDI File (formato 1), sin dependencias."""
import struct


def _vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def write_smf(path, ppq, tracks):
    """tracks: lista de listas de (tick_absoluto, bytes_evento). La pista 0 lleva el tempo."""
    chunks = []
    for events in tracks:
        events = sorted(events, key=lambda e: (e[0], 0 if e[1][0] & 0xF0 == 0x80 else 1))
        data = bytearray()
        last = 0
        for tick, ev in events:
            data += _vlq(tick - last) + ev
            last = tick
        data += _vlq(0) + b"\xff\x2f\x00"
        chunks.append(b"MTrk" + struct.pack(">I", len(data)) + bytes(data))
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), ppq)
    with open(path, "wb") as f:
        f.write(header + b"".join(chunks))


def tempo_event(bpm):
    us = round(60_000_000 / bpm)
    return b"\xff\x51\x03" + us.to_bytes(3, "big")


def name_event(name):
    raw = name.encode("latin1", "replace")
    return b"\xff\x03" + _vlq(len(raw)) + raw
