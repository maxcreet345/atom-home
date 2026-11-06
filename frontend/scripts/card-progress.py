#!/usr/bin/env python3
# Draws the state of the Atom Home card cycle from its journal and evidence. usage: progress.py <journal> <cycle dir>
import json, os, re, sys, time, glob
J, C = sys.argv[1], sys.argv[2]
bar = lambda d, t, w=20: '█' * round(w * d / t if t else 0) + '░' * (w - round(w * d / t if t else 0)) + f' {d}/{t}'
rows = [json.loads(l) for l in open(J)]
label = {r['agentId']: r.get('label', '') for r in rows if r.get('type') == 'started'}
state = {}
for r in rows:
    a, l = r.get('agentId'), label.get(r.get('agentId'), '')
    if r.get('type') == 'started': state[a] = 'run'
    elif r.get('type') == 'result': state[a] = 'ok'
    elif r.get('type') == 'failed': state[a] = 'dead'
rounds = sorted({int(m.group(1)) for l in label.values() for m in [re.search(r'round (\d+)', l)] if m})
R = rounds[-1] if rounds else 1
here = {a: l for a, l in label.items() if re.search(rf'\b{R}\b', l)}
audits = {a: l for a, l in here.items() if not re.match(r'(round|triage|fix)', l)}
print(f'Круг {R} (максимум 6)')
ev = f'{C}/round-{R}'
gate = os.path.exists(f'{ev}/gate.out'); done = os.path.exists(f'{ev}/DONE')
print('Проверка кода  ', 'готово' if done or os.path.exists(f'{ev}/build.out') else ('идёт' if gate else 'ждёт'))
for d, n in (('pad', 'Планшет'), ('open', 'Open'), ('13r', '13R')):
    log, rep = f'{ev}/{d}.log', f'{ev}/{d}/report.json'
    shots = len(glob.glob(f'{ev}/{d}/*.png'))
    if not os.path.exists(log): print(f'{n:<14}', 'ждёт'); continue
    t = 'готово' if os.path.exists(rep) and done else 'идёт'
    print(f'{n:<14}', t, f'снимков {shots}')
if audits:
    ok = sum(state[a] == 'ok' for a in audits)
    print('Аудиты         ', bar(ok, len(audits)))
    run = [l.split(' (')[0] for a, l in audits.items() if state[a] == 'run']
    if run: print('  идут:', ', '.join(run))
    dead = [l.split(' (')[0] for a, l in audits.items() if state[a] == 'dead']
    if dead: print('  умерли:', ', '.join(dead))
else: print('Аудиты         ', 'ждёт')
tri = [a for a, l in here.items() if l.startswith('triage')]
print('Разбор находок ', 'готово' if tri and state[tri[-1]] == 'ok' else ('идёт' if tri else 'ждёт'))
fix = [a for a, l in here.items() if l.startswith('fix')]
g = f'{ev}/fix-gate'
fixing = fix and state[fix[-1]] == 'run'
print('Исправления    ', 'готово' if fix and state[fix[-1]] == 'ok' else (('финальная проверка' if os.path.exists(g + '.out') and not os.path.exists(g + '.done') else 'правит код') if fixing else 'ждёт'))
