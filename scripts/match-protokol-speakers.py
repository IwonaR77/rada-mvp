#!/usr/bin/env python3
"""Propose segment speaker assignments from an official session protokół (BIP).

Usage:
    python3 scripts/match-protokol-speakers.py <protokol.pdf or URL> [--apply]

Downloads (if given a URL) and reads a session protokół PDF, cross-references
its speaker-attributed dialogue against the already-transcribed `segment`
rows for the matching meeting (found via the session date embedded in the
PDF), and proposes confirmed_councilor_id/confirmed_official_id + status =
'proposed' for segments that don't have one yet. Never touches a segment
that already has a confirmed_councilor_id/confirmed_official_id or a status
other than 'open'.

By default this only prints an analysis and writes an UPDATE ... .sql file
next to the input (dry run). Pass --apply to actually run it against the
linked Supabase project via `supabase db query --linked -f`.

Needs `pdftotext` (poppler-utils) on PATH.

Known limitations (see project_protokol_speaker_matching memory for more):
  - The protokół sometimes summarizes a verbatim reading (a resolution's full
    legal text, a guest official's report) as one line instead of
    transcribing it -- the anchor-and-fill alignment below infers the reader
    keeps speaking through that gap, which is usually right but can attach a
    long untranscribed passage to the wrong (preceding) speaker if the real
    content afterwards doesn't reappear in the protokół either.
  - Documents have used at least four different speaker-citation formats
    across sessions (the vendor's export format changed over time) -- if a
    new protokół resolves suspiciously few blocks, check `unresolved` output
    for lines that look like real dialogue attribution and add a new regex.
  - `KNOWN_ROLE_HOLDERS` below is a snapshot for 2025 sessions (chair,
    vice-chair, burmistrz, skarbnik, sekretarz) -- update it if these change
    (e.g. a new skarbnik, or a vice-chair replaced after a Rada vote).
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import time
import unicodedata

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ROLE_WORDS = [
    "Przewodnicząca Rady Miejskiej", "Przewodniczący Rady Miejskiej",
    "Przewodnicząca Rady", "Przewodniczący Rady",
    "Wiceprzewodnicząca Rady Miejskiej", "Wiceprzewodniczący Rady Miejskiej",
    "Wiceprzewodnicząca Rady", "Wiceprzewodniczący Rady",
    "Burmistrz Gminy i Miasta Grójec", "Burmistrz",
    "Zastępca Burmistrza", "Skarbnik Gminy Grójec", "Skarbnik Gminy", "Skarbnik",
    "Zastępca Skarbnika", "Sekretarz Gminy", "Sekretarz",
    "Radny", "Radna", "Pan", "Pani", "Gość", "Mieszkaniec", "Mieszkanka",
    "Dyrektor", "Naczelnik",
]

# snapshot of who held each generic role during 2025 sessions -- lets a
# role-only citation ("Zastępca Burmistrza:") resolve even when that role
# never appears together with a name in the same document
KNOWN_ROLE_HOLDERS_2025 = {
    "Przewodnicząca Rady Miejskiej": "Dorota Niedbała",
    "Przewodnicząca Rady": "Dorota Niedbała",
    "Wiceprzewodniczący Rady Miejskiej": "Artur Szlis",
    "Wiceprzewodniczący Rady": "Artur Szlis",
    "Burmistrz Gminy i Miasta Grójec": "Dariusz Gwiazda",
    "Burmistrz": "Dariusz Gwiazda",
    "Zastępca Burmistrza": "Jarosław Rupiewicz",
    "Skarbnik Gminy Grójec": "Mariola Komorowska",
    "Skarbnik Gminy": "Mariola Komorowska",
    "Skarbnik": "Mariola Komorowska",
    "Sekretarz Gminy": "Sebastian Litewnicki",
    "Sekretarz": "Sebastian Litewnicki",
}

NAME_PART = r"[A-ZŁŚŻŹĆŃÓĄĘ][\wąćęłńóśźż.]*(?:\s+[A-ZŁŚŻŹĆŃÓĄĘ][\wąćęłńóśźż.-]*){0,4}"
NAME_RE = re.compile(rf"^({NAME_PART})\s+-\s+(.*)$")
NAME_RE_DASH = re.compile(rf"^-\s+({NAME_PART}):\s+(.*)$")
NAME_RE_COLON = re.compile(rf"^({NAME_PART}):\s+(.+)$")
NAME_RE_DASH_BOTH = re.compile(rf"^-\s+({NAME_PART})\s+[-–]\s+(.*)$")

DATE_RE = re.compile(r"w dniu\w?\s+(\d{1,2})\s+(\w+)\s+(\d{4})")
DATE_ISO_RE = re.compile(r"Obrady rozpocz[eę]to\s+(\d{4})-(\d{2})-(\d{2})")
MONTHS = {"stycznia": 1, "lutego": 2, "marca": 3, "kwietnia": 4, "maja": 5, "czerwca": 6,
          "lipca": 7, "sierpnia": 8, "września": 9, "października": 10, "listopada": 11, "grudnia": 12}


def sb_query(sql, retries=3):
    last_err = None
    for attempt in range(retries):
        r = subprocess.run(["npx", "supabase", "db", "query", "--linked", sql],
                            capture_output=True, text=True, cwd=REPO_ROOT, timeout=60)
        idx = r.stdout.find("{")
        if idx == -1:
            last_err = f"supabase query failed: {r.stdout} {r.stderr}"
        else:
            try:
                data = json.loads(r.stdout[idx:])
                if "rows" in data:
                    return data["rows"]
                last_err = f"transient API error: {data}"
            except json.JSONDecodeError:
                last_err = f"bad json: {r.stdout[idx:idx + 300]}"
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(last_err)


def sb_apply_sql(sql_path):
    r = subprocess.run(["npx", "supabase", "db", "query", "--linked", "-f", sql_path],
                        capture_output=True, text=True, cwd=REPO_ROOT, timeout=120)
    print(r.stdout)
    if r.returncode != 0:
        raise RuntimeError(f"apply failed: {r.stdout} {r.stderr}")


def load_roster():
    councilors = sb_query("select id, full_name from councilor;")
    officials = sb_query("select id, full_name from official;")
    all_names = {r["full_name"]: ("councilor", r["id"]) for r in councilors}
    all_names.update({r["full_name"]: ("official", r["id"]) for r in officials})
    lastname_index = {}
    for full, (kind, i) in all_names.items():
        lastname_index.setdefault(full.split()[-1], []).append((full, kind, i))
    return all_names, lastname_index


def resolve_speaker(prefix, role_holders, all_names, lastname_index):
    prefix = prefix.strip()
    # pdftotext sometimes inserts a stray space around a hyphenated surname
    # ("Śliwa- Jóźwik") -- normalize before substring matching
    normalized = re.sub(r"\s*-\s*", "-", prefix)
    for full in all_names:
        if full in normalized or full in prefix:
            return full, all_names[full]
    words = prefix.split()
    if words:
        last = words[-1].rstrip(".")
        if last in lastname_index and len(lastname_index[last]) == 1:
            full, kind, i = lastname_index[last][0]
            return full, (kind, i)
    stripped = prefix
    for hon in ("Pan ", "Pani "):
        stripped = stripped.replace(hon, "")
    stripped = stripped.strip().rstrip(".")
    for role in ROLE_WORDS:
        if stripped == role and role in role_holders:
            full = role_holders[role]
            return full, all_names.get(full, (None, None))
    return None, (None, None)


def normalize_role_key(prefix):
    for hon in ("Pan ", "Pani "):
        prefix = prefix.replace(hon, "")
    prefix = prefix.strip()
    for role in sorted(ROLE_WORDS, key=len, reverse=True):
        if prefix.startswith(role):
            return role
    return None


def parse_blocks(text):
    blocks = []
    current = None
    for line in text.split("\n"):
        stripped = line.strip()
        m = (NAME_RE_DASH_BOTH.match(stripped) or NAME_RE_DASH.match(stripped)
             or NAME_RE_COLON.match(stripped) or NAME_RE.match(stripped))
        if m:
            if current:
                blocks.append(current)
            current = [m.group(1), [m.group(2)]]
        elif current:
            current[1].append(stripped)
    if current:
        blocks.append(current)
    return blocks


def tokenize(s):
    return re.findall(r"[a-ząćęłńóśźż0-9]+", unicodedata.normalize("NFKC", s.lower()))


def extract_session_date(text):
    # the session header is always within the first few lines -- searching
    # the whole document risks matching an unrelated date mentioned later
    # (e.g. a cited skarga date). Two formats seen: "30 stycznia 2025" and
    # ISO "2025-02-27" (via the always-present "Obrady rozpoczęto" line).
    head = text[:600]
    m_iso = DATE_ISO_RE.search(head)
    if m_iso:
        year, month, day = m_iso.groups()
        return f"{year}-{month}-{day}"
    m = DATE_RE.search(head)
    if not m:
        return None
    day, month_word, year = m.groups()
    month = MONTHS.get(month_word)
    return f"{year}-{month:02d}-{int(day):02d}" if month else None


def find_anchor(block_tokens, seg_tokens, search_from, search_to, probe_segments=5):
    probe = block_tokens[:40]
    if not probe:
        return None, 0.0
    best_idx, best_score = None, 0.0
    for start in range(search_from, search_to):
        window = []
        for j in range(start, min(start + probe_segments, len(seg_tokens))):
            window.extend(seg_tokens[j])
        if not window:
            continue
        score = difflib.SequenceMatcher(None, probe, window, autojunk=False).ratio()
        if score > best_score:
            best_score, best_idx = score, start
    return best_idx, best_score


def align_to_segments(resolved_blocks, segments, anchor_threshold=0.28):
    """Anchor-and-fill: find a reliable starting segment for each block, then
    assign every segment between two consecutive anchors to the earlier
    block's speaker (handles blocks whose bulk content -- e.g. a verbatim
    resolution reading -- isn't reproduced in the protokół text)."""
    seg_tokens = [tokenize(s["text"]) for s in segments]
    n = len(segments)
    anchors, cursor = [], 0
    for name, kind, pid, block_text in resolved_blocks:
        tokens = tokenize(block_text)
        if not tokens or cursor >= n:
            continue
        idx, score = find_anchor(tokens, seg_tokens, cursor, n)
        if idx is not None and score >= anchor_threshold:
            anchors.append((idx, name, kind, pid, round(score, 3)))
            cursor = idx + 1
    assignments = {}
    for i, (start_idx, name, kind, pid, score) in enumerate(anchors):
        end_idx = anchors[i + 1][0] if i + 1 < len(anchors) else n
        for seg_i in range(start_idx, end_idx):
            assignments[seg_i] = (name, kind, pid, score)
    return assignments


def get_pdf_text(pdf_source, workdir):
    if pdf_source.startswith("http://") or pdf_source.startswith("https://"):
        pdf_path = os.path.join(workdir, "protokol.pdf")
        subprocess.run(["curl", "-sL", pdf_source, "-o", pdf_path], check=True, timeout=30)
    else:
        pdf_path = pdf_source
    txt_path = os.path.join(workdir, "protokol.txt")
    subprocess.run(["pdftotext", "-layout", pdf_path, txt_path], check=True, timeout=30)
    with open(txt_path) as f:
        return f.read()


def process_session(text, roster, apply=False):
    all_names, lastname_index = roster
    session_date = extract_session_date(text)
    if not session_date:
        print("Could not find the session date in this document -- aborting.")
        return
    meetings = sb_query(f"select id, esesja_id from meeting where date = '{session_date}';")
    if not meetings:
        print(f"No meeting found in the DB for date {session_date} -- aborting.")
        return
    meeting_id, esesja_id = meetings[0]["id"], meetings[0]["esesja_id"]
    print(f"=== Session date {session_date}, esesja_id={esesja_id}, meeting_id={meeting_id} ===")

    role_holders = dict(KNOWN_ROLE_HOLDERS_2025)
    resolved_blocks, unresolved_names = [], set()
    for prefix, text_lines in parse_blocks(text):
        full_text = " ".join(t for t in text_lines if t)
        name, (kind, pid) = resolve_speaker(prefix, role_holders, all_names, lastname_index)
        role_key = normalize_role_key(prefix)
        if name and role_key:
            role_holders[role_key] = name
        if name:
            resolved_blocks.append((name, kind, pid, full_text))
        else:
            unresolved_names.add(prefix)

    print(f"Blocks resolved: {len(resolved_blocks)}, unresolved: {len(unresolved_names)}")
    if unresolved_names:
        print(f"  Unresolved: {sorted(unresolved_names)}")

    segments = sb_query(
        "select s.id, s.start_time, s.text, s.status, s.confirmed_councilor_id, "
        "s.confirmed_official_id from segment s "
        f"where s.meeting_id = '{meeting_id}' order by s.start_time;"
    )
    assignments = align_to_segments(resolved_blocks, segments)

    lines = ["begin;"]
    written = 0
    for i, (name, kind, pid, score) in assignments.items():
        seg = segments[i]
        if seg["confirmed_councilor_id"] or seg["confirmed_official_id"] or seg["status"] != "open":
            continue
        col = "confirmed_councilor_id" if kind == "councilor" else "confirmed_official_id"
        lines.append(
            f"update segment set {col} = '{pid}', status = 'proposed' "
            f"where id = '{seg['id']}' and status = 'open' "
            "and confirmed_councilor_id is null and confirmed_official_id is null;"
        )
        written += 1
    lines.append("commit;")

    sql_path = f"/tmp/protokol-{esesja_id}-assign.sql"
    with open(sql_path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Segments: {len(segments)} total, {written} newly proposable -- wrote {sql_path}")

    if apply:
        print("Applying...")
        sb_apply_sql(sql_path)
    else:
        print(f"Dry run only. Re-run with --apply to write these to the DB, or:\n"
              f"  npx supabase db query --linked -f {sql_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="protokół PDF path or URL")
    parser.add_argument("--apply", action="store_true", help="write the proposed assignments to the DB")
    args = parser.parse_args()

    import tempfile
    with tempfile.TemporaryDirectory() as workdir:
        text = get_pdf_text(args.source, workdir)
        roster = load_roster()
        process_session(text, roster, apply=args.apply)


if __name__ == "__main__":
    main()
