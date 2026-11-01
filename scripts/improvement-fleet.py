#!/usr/bin/env python3
"""Bounded OpenCode NVIDIA workers. Outputs are candidates, never merged automatically."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tempfile

DEFAULT_RELAY = Path.home() / '.agents/skills/opencode-delegate/scripts/relay.mjs'
SECRET = re.compile(rb'(?:nvapi-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
SENSITIVE = {'.git', '.env', '.config', '.local', 'node_modules', 'auth.json', 'credentials.json', 'tokens.json', 'opencode.json'}
MAX_INPUT = 2 * 1024 * 1024
MAX_OUTPUT = 256 * 1024
MAX_SUMMARY = 4096


def relative(value):
    if not isinstance(value, str) or not value or len(value.encode()) > 180 or '\\' in value:
        raise ValueError('Caminho relativo invalido')
    p = PurePosixPath(value)
    if p.is_absolute() or any(x in ('', '.', '..') for x in value.split('/')):
        raise ValueError('Caminho deve ser relativo, sem travessia')
    if any(x in SENSITIVE or x.startswith('.env') for x in p.parts) or p.suffix.lower() in ('.key', '.pem', '.cert', '.crt'):
        raise ValueError('Arquivo sensivel/dependencia nao permitido')
    return p


def contained(root, name):
    p = root / relative(name)
    cursor = root
    for component in relative(name).parts:
        cursor /= component
        if cursor.is_symlink():
            raise ValueError('Link simbolico nao permitido')
    if not p.resolve().is_relative_to(root.resolve()):
        raise ValueError('Caminho fora da raiz')
    return p


def load_manifest(path, root):
    if SECRET.search(path.read_bytes()):
        raise ValueError('Possivel segredo no manifesto; conteudo omitido')
    data = json.loads(path.read_text())
    tasks = data.get('tasks', [])
    if not 1 <= len(tasks) <= 8:
        raise ValueError('Manifesto exige entre 1 e 8 tarefas')
    ids = [t.get('id', '') for t in tasks]
    if len(set(ids)) != len(ids) or any(not re.fullmatch(r'[a-z][a-z0-9-]{0,39}', x) for x in ids):
        raise ValueError('IDs invalidos ou duplicados')
    for task in tasks:
        model = task.get('model', '')
        if not re.fullmatch(r'nvidia/[A-Za-z0-9][A-Za-z0-9._/-]*', model):
            raise ValueError('Somente modelos explicitos do provider nvidia')
        if not isinstance(task.get('timeout_seconds', 240), int) or not 15 <= task.get('timeout_seconds', 240) <= 600:
            raise ValueError('Prazo deve ser 15..600 segundos')
        if task.get('corrections', 0) not in (0, 1):
            raise ValueError('No maximo uma correcao')
        if not isinstance(task.get('objective'), str) or not task['objective'].strip():
            raise ValueError('Objetivo obrigatorio')
        if not task.get('outputs') or len(task['outputs']) > 4:
            raise ValueError('Declare 1..4 artefatos por tarefa')
        names = set()
        for source in task.get('inputs', []):
            p = contained(root, source)
            if not p.is_file() or p.stat().st_size > MAX_INPUT or SECRET.search(p.read_bytes()):
                raise ValueError('Entrada ausente, extensa ou sensivel')
            names.add(source)
        output_names = set()
        for out in task['outputs']:
            relative(out['path'])
            if out['path'] == 'AGENTS.md' or out['path'] in names or out['path'] in output_names:
                raise ValueError('Saida deve ser exclusiva e nao sobrescrever entrada')
            if out.get('kind', 'json') not in ('json', 'text'):
                raise ValueError('Artefatos aceitos: json ou text; nao executamos codigo do trabalhador')
            output_names.add(out['path'])
        deps = task.get('depends_on', [])
        if len(set(deps)) != len(deps) or any(x not in ids or x == task['id'] for x in deps):
            raise ValueError('Dependencias invalidas')
        for dep, files in task.get('dependency_artifacts', {}).items():
            if dep not in deps:
                raise ValueError('Artefato requer dependencia declarada')
            available = {o['path'] for t in tasks if t['id'] == dep for o in t['outputs']}
            if any(f not in available for f in files):
                raise ValueError('Artefato de dependencia nao declarado')
    visited = set()
    while len(visited) < len(tasks):
        ready = [t['id'] for t in tasks if t['id'] not in visited and set(t.get('depends_on', [])).issubset(visited)]
        if not ready:
            raise ValueError('Ciclo nas dependencias')
        visited.update(ready)
    return tasks


def bounded(value, limit):
    return str(value).encode('utf-8')[:limit].decode('utf-8', errors='ignore')


def file_state(work):
    state = {}
    for p in work.rglob('*'):
        name = p.relative_to(work).as_posix()
        if '.git' in p.relative_to(work).parts:
            continue
        if p.is_symlink():
            state[name] = 'symlink'
        elif p.is_file():
            if p.stat().st_size > MAX_INPUT:
                state[name] = 'oversized'
            else:
                state[name] = hashlib.sha256(p.read_bytes()).hexdigest()
    return state


def validate(work, before, task):
    after = file_state(work)
    allowed = {o['path'] for o in task['outputs']}
    changed = {n for n in before.keys() | after.keys() if before.get(n) != after.get(n)}
    if changed - allowed:
        raise ValueError('Escrita fora do escopo: ' + ', '.join(sorted(changed - allowed)[:3]))
    for out in task['outputs']:
        p = contained(work, out['path'])
        if not p.is_file() or not 0 < p.stat().st_size <= MAX_OUTPUT:
            raise ValueError('Artefato ausente, vazio ou acima de 256 KiB: ' + out['path'])
        content = p.read_bytes()
        if SECRET.search(content):
            raise ValueError('Artefato com possivel segredo; conteudo omitido')
        if out.get('kind', 'json') == 'json':
            def invalid_constant(value):
                raise ValueError('Numero nao finito no JSON: ' + out['path'])
            obj = json.loads(content, parse_constant=invalid_constant)
            if not isinstance(obj, dict) or not set(out.get('required_keys', [])).issubset(obj):
                raise ValueError('Contrato JSON invalido: ' + out['path'])
            for key, bounds in out.get('numeric_ranges', {}).items():
                val = obj
                for field in key.split('.'):
                    val = val[field]
                if isinstance(val, bool) or not isinstance(val, (int, float)) or not bounds[0] <= val <= bounds[1]:
                    raise ValueError('Valor numerico fora do intervalo: ' + key)
    return changed


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def write_task_summary(path, data):
    small = dict(data)
    encoded = json.dumps(small, ensure_ascii=False, separators=(',', ':'))
    if len(encoded.encode()) > 1200:
        small.pop('outputs', None)
        small['artifacts'] = 'work/'
        encoded = json.dumps(small, ensure_ascii=False, separators=(',', ':'))
    if len(encoded.encode()) > 1200:
        raise ValueError('Resumo individual acima de 1200 bytes')
    path.write_text(encoded + '\n')


def run_process(argv, cwd, log, timeout):
    # No shell, and a dedicated process group: never kill unrelated OpenCode sessions.
    with log.open('wb') as stream:
        process = subprocess.Popen(argv, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return process.wait(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise


def worker(task, root, run_root, relay, results):
    folder = run_root / task['id']
    work = folder / 'work'
    work.mkdir(parents=True, mode=0o700)
    inputs = []
    for name in task.get('inputs', []):
        target = contained(work, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(contained(root, name), target)
        inputs.append(name)
    for dep, names in task.get('dependency_artifacts', {}).items():
        for name in names:
            target_name = f'dependencies/{dep}/{name}'
            target = contained(work, target_name)
            target.parent.mkdir(parents=True, exist_ok=True)
            source = contained(run_root / dep / 'work', name)
            shutil.copyfile(source, target)
            inputs.append(target_name)
    guidance = ('Trabalhador NVIDIA. Leia apenas as entradas do brief. Escreva apenas as saidas declaradas. '
                'Nao leia credenciais, configuracoes globais ou o projeto original. Nao chame outros providers, '
                'nao delegue, nao faca commit/push/deploy, nao instale dependencias. Artefatos extensos ficam em disco.\n')
    (work / 'AGENTS.md').write_text(guidance)
    subprocess.run(['git', 'init', '-q', str(work)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    before = file_state(work)
    write_json(folder / 'baseline.json', before)
    output_contract = json.dumps(task['outputs'], ensure_ascii=False, indent=2)
    brief = (f"Objetivo: {task['objective']}\nContexto: {task.get('context', '')}\n"
             f"Leia somente: {json.dumps(inputs)} e AGENTS.md.\nPode escrever somente: {output_contract}\n"
             'Execute ferramentas e grave os artefatos agora; nao retorne apenas um plano. '
             'JSON: numeros finitos, sem comentarios ou cercas Markdown. '
             'Nao execute codigo gerado. ' + guidance + '\n'
             'Retorno: no maximo cinco linhas e 100 palavras: STATUS; O QUE FEZ; ARQUIVOS; VALIDACAO; PENDENCIA/BLOQUEIO. '
             'Nao transcreva logs, artefatos nem raciocinio.\n')
    brief_path = folder / 'brief.txt'
    brief_path.write_text(brief)
    timeout = task.get('timeout_seconds', 240)
    session = None
    failure = None
    for attempt in range(task.get('corrections', 0) + 1):
        outdir = folder / f'attempt-{attempt + 1}'
        outdir.mkdir()
        if attempt:
            brief_path = folder / 'delta.txt'
            brief_path.write_text(f'Corrija apenas esta falha de contrato: {failure}. Grave as saidas pendentes. '
                                  'Mantenha o escopo original. Retorno em cinco linhas curtas.\n')
        cmd = ['node', str(relay), '--brief', str(brief_path), '--cd', str(work), '--model', task['model'],
               '--pure', '--timeout', f'{timeout}s', '--out-dir', str(outdir)]
        if attempt:
            cmd.extend(['--session', session])
        status, exit_code = 'failed', None
        try:
            return_code = run_process(cmd, work, outdir / 'relay.log', timeout + 30)
            result_path = outdir / 'result.json'
            if not result_path.is_file() or result_path.stat().st_size > 2 * MAX_INPUT:
                raise ValueError('Relay nao produziu resultado valido')
            result = json.loads(result_path.read_text())
            session = result.get('sessionId')
            status, exit_code = result.get('status'), result.get('exitCode')
            if return_code != 0 or status != 'completed' or exit_code != 0:
                raise ValueError('Relay: ' + str(status))
            changed = validate(work, before, task)
            summary = {'id': task['id'], 'status': 'candidate', 'relayStatus': status,
                       'exitCode': exit_code, 'sessionId': session, 'attempts': attempt + 1,
                       'outputs': sorted(changed), 'validation': 'escopo, existencia, tamanho e contrato verificados; revisao humana pendente'}
            write_task_summary(folder / 'summary.json', summary)
            return summary
        except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as err:
            failure = bounded(err, 200)
            if SECRET.search(failure.encode()):
                failure = 'Conteudo sensivel omitido'
            # Retry only completed runs with a session and a correctable in-scope artifact error.
            if not (status == 'completed' and isinstance(session, str) and session.startswith('ses_') and attempt == 0
                    and task.get('corrections') == 1 and 'fora do escopo' not in failure and 'segredo' not in failure):
                break
    summary = {'id': task['id'], 'status': 'failed', 'relayStatus': status, 'exitCode': exit_code,
               'sessionId': session, 'attempts': attempt + 1, 'reason': failure}
    write_task_summary(folder / 'summary.json', summary)
    return summary


def dispatch(tasks, root, run_root, relay, parallel):
    results, pending, active = {}, {t['id']: t for t in tasks}, {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=parallel) as pool:
        while pending or active:
            for name, task in list(pending.items()):
                deps = task.get('depends_on', [])
                if not all(d in results for d in deps):
                    continue
                if any(results[d]['status'] != 'candidate' for d in deps):
                    results[name] = {'id': name, 'status': 'skipped', 'reason': 'Dependencia falhou; executar localmente ou rever o brief'}
                    del pending[name]
                elif len(active) < parallel:
                    future = pool.submit(worker, task, root, run_root, relay, results)
                    active[future] = name
                    del pending[name]
            if active:
                done, _ = concurrent.futures.wait(active, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:
                    name = active.pop(future)
                    try:
                        results[name] = future.result()
                    except Exception as err:
                        results[name] = {'id': name, 'status': 'failed', 'reason': 'Falha local: ' + type(err).__name__}
                    write_json(run_root / 'results.json', results)
    return results


def compact_report(results, run_root):
    entries = []
    for value in results.values():
        entry = {k: value[k] for k in ('id', 'status', 'attempts', 'sessionId', 'reason') if k in value}
        entry['artifacts'] = f"{value['id']}/work"
        entries.append(entry)
    report = {'run': str(run_root), 'tasks': entries, 'integration': 'revisao do orquestrador pendente'}
    encoded = json.dumps(report, ensure_ascii=False, separators=(',', ':'))
    if len(encoded.encode()) > MAX_SUMMARY:
        for entry in entries:
            entry.pop('reason', None)
            entry.pop('sessionId', None)
        encoded = json.dumps(report, ensure_ascii=False, separators=(',', ':'))
    if len(encoded.encode()) > MAX_SUMMARY:
        raise ValueError('Resumo acima de 4 KiB')
    return encoded


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path('config/robot-improvement-tasks.json'))
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--relay', type=Path, default=DEFAULT_RELAY)
    parser.add_argument('--parallel', type=int, choices=(1, 2), default=2)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--run', action='store_true', help='Usar o acesso NVIDIA ja autorizado')
    mode.add_argument('--dry-run', action='store_true', help='Validar manifesto sem chamar modelos (padrao)')
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve()
        manifest = args.manifest if args.manifest.is_absolute() else root / args.manifest
        tasks = load_manifest(manifest, root)
        if not args.run:
            print(json.dumps({'mode': 'dry-run', 'parallel': args.parallel, 'tasks': [
                {'id': t['id'], 'model': t['model'], 'depends_on': t.get('depends_on', []),
                 'outputs': [o['path'] for o in t['outputs']]} for t in tasks]}, ensure_ascii=False))
            return 0
        if not args.relay.is_file():
            raise ValueError('Relay OpenCode ausente')
        opencode = shutil.which('opencode')
        if not opencode:
            raise ValueError('OpenCode nao instalado')
        catalog = subprocess.run([opencode, 'models', 'nvidia'], capture_output=True, text=True, timeout=30)
        models = set(catalog.stdout.splitlines())
        if catalog.returncode or any(t['model'] not in models for t in tasks):
            raise ValueError('Modelo NVIDIA ausente no catalogo local; nao ha fallback pago')
        # Private scratch; never copy credential directories. OpenCode authenticates itself.
        run_root = Path(tempfile.mkdtemp(prefix='pulso-fleet-'))
        os.chmod(run_root, 0o700)
        snapshot = run_root / 'snapshot'
        snapshot.mkdir(mode=0o700)
        for name in sorted({name for task in tasks for name in task.get('inputs', [])}):
            source = contained(root, name)
            content = source.read_bytes()
            if len(content) > MAX_INPUT or SECRET.search(content):
                raise ValueError('Entrada alterada para conteudo extenso ou sensivel')
            target = contained(snapshot, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        write_json(run_root / 'manifest.json', {'tasks': tasks})
        write_json(run_root / 'snapshot-hashes.json', file_state(snapshot))
        results = dispatch(tasks, snapshot, run_root, args.relay.resolve(), args.parallel)
        encoded = compact_report(results, run_root)
        (run_root / 'summary.json').write_text(encoded + '\n')
        print(encoded)
        return 0 if all(r['status'] == 'candidate' for r in results.values()) else 1
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as err:
        print('Erro: ' + bounded(err, 250), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
